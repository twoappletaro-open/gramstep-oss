import type { Env } from "../env.js";

export async function verifySignature(
  body: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const expectedPrefix = "sha256=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;

  const receivedHex = signatureHeader.slice(expectedPrefix.length);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computedBytes = new Uint8Array(signature);
  const receivedBytes = new Uint8Array(receivedHex.length / 2);
  for (let i = 0; i < receivedBytes.length; i++) {
    receivedBytes[i] = parseInt(receivedHex.substring(i * 2, i * 2 + 2), 16);
  }

  if (computedBytes.length !== receivedBytes.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < computedBytes.length; i++) {
    diff |= (computedBytes[i] ?? 0) ^ (receivedBytes[i] ?? 0);
  }
  return diff === 0;
}

export async function bufferToKV(
  kv: KVNamespace,
  eventId: string,
  payload: string,
): Promise<void> {
  await kv.put(`d1_buffer:${eventId}`, payload, { expirationTtl: 86400 });
}

export interface WebhookEntry {
  id: string;
  time: number;
  messaging?: MessagingEvent[];
  changes?: ChangeEvent[];
}

export interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: MessageData;
  postback?: PostbackData;
  referral?: ReferralData;
  read?: ReadData;
  reaction?: ReactionData;
}

export interface MessageData {
  mid: string;
  text?: string;
  is_echo?: boolean;
  is_deleted?: boolean;
  attachments?: AttachmentData[];
  sticker_id?: string;
  quick_reply?: { payload: string };
}

export interface AttachmentData {
  type: string;
  payload?: { url?: string };
}

export interface PostbackData {
  mid: string;
  title: string;
  payload: string;
}

export interface ReferralData {
  ref?: string;
  source?: string;
  type?: string;
}

export interface ReadData {
  watermark: number;
}

export interface ReactionData {
  mid: string;
  action: string;
  reaction?: string;
  emoji?: string;
}

export interface ChangeEvent {
  field: string;
  value: Record<string, unknown>;
}

export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export function extractEventId(event: MessagingEvent): string {
  if (event.message) return event.message.mid;
  if (event.postback) return event.postback.mid;
  return `${event.sender.id}_${event.timestamp}`;
}

export async function processEntryAsync(
  entry: WebhookEntry,
  env: Env,
): Promise<void> {
  const { processWebhookEvent } = await import("./event-processor.js");
  const { upsertIgUser, recordMessageLog } = await import("./user-registration.js");
  const { handleMessagingSeen } = await import("./message-logger.js");
  const { handleMessageDeletion } = await import("./message-deletion.js");
  const { createAccountResolver } = await import("./account-resolver.js");

  // マルチアカウントルーティング: entry.id (IG Page ID) → account_id
  const resolver = createAccountResolver({ db: env.DB, kv: env.KV });
  const accountResult = await resolver.resolveWebhookEntryAccountId(entry.id);
  if (!accountResult.ok) {
    // 未登録アカウントのWebhookは処理せず破棄
    return;
  }
  const accountId = accountResult.value;

  // entry.changes 処理（comments / live_comments 等）
  if (entry.changes) {
    for (const change of entry.changes) {
      await processChangeEvent(change, accountId, env);
    }
  }

  if (!entry.messaging) return;

  for (const event of entry.messaging) {
    // is_deleted フラグ検知: メッセージ削除イベントを記録
    if (event.message?.is_deleted && event.message.mid) {
      await handleMessageDeletion(env.DB, {
        accountId,
        igMessageId: event.message.mid,
        deletedAt: Math.floor(event.timestamp / 1000),
      });
      continue;
    }

    const result = await processWebhookEvent(event, accountId, env.DB);

    // is_echo: 送信確認としてログ記録（自己ループ防止のためスキップはするが記録は残す）
    if (result.skipped && result.reason === "is_echo" && event.message) {
      await recordMessageLog(env.DB, {
        accountId,
        igUserId: "", // is_echo は recipient 側が自アカウント
        direction: "outbound",
        messageType: event.message.text ? "text" : "unknown",
        content: event.message.text ?? null,
        sourceType: "is_echo",
        igMessageId: event.message.mid,
      });
      continue;
    }

    if (result.skipped) continue;

    // messaging_seen (read) イベント: 送信メッセージのステータスをreadに更新
    if (result.eventType === "read" && event.read) {
      const userResult = await upsertIgUser(env.DB, {
        accountId,
        igScopedId: event.sender.id,
        timestamp: Math.floor(event.timestamp / 1000),
      });
      await handleMessagingSeen(env.DB, {
        accountId,
        igUserId: userResult.userId,
        watermark: event.read.watermark,
      });
      continue;
    }

    const userResult = await upsertIgUser(env.DB, {
      accountId,
      igScopedId: event.sender.id,
      timestamp: Math.floor(event.timestamp / 1000),
    });

    // プロフィール未取得ユーザー: /{IGSID} User Profile APIでプロフィール取得
    const existingProfile = await env.DB.prepare(
      "SELECT ig_username FROM ig_users WHERE id = ?",
    ).bind(userResult.userId).first<{ ig_username: string | null }>();
    const needsProfile = userResult.isNew || !existingProfile?.ig_username;
    if (needsProfile) {
      try {
        const { getDecryptedToken } = await import("./auth-service.js");
        const { generateAppSecretProof } = await import("./crypto.js");
        const { createRealInstagramClient } = await import("@gramstep/ig-sdk");
        const tokenResult = await getDecryptedToken(accountId, {
          db: env.DB, kv: env.KV, encryptionKey: env.ENCRYPTION_KEY,
        });
        if (tokenResult.ok) {
          const proof = await generateAppSecretProof(tokenResult.value, env.META_APP_SECRET);
          const igClient = createRealInstagramClient({
            accessToken: tokenResult.value,
            apiVersion: env.META_API_VERSION,
          });
          const profileResult = await igClient.getUserProfile(event.sender.id, tokenResult.value, proof);
          if (profileResult.ok && profileResult.value.username) {
            const p = profileResult.value;
            const followerStatus = (p.is_user_follow_business ?? p.isUserFollowingBusiness) ? "following" : "unknown";
            await env.DB.prepare(
              "UPDATE ig_users SET ig_username = ?, display_name = ?, follower_status = ?, updated_at = ? WHERE id = ?",
            ).bind(p.username ?? null, p.name ?? p.username ?? null, followerStatus, Math.floor(Date.now() / 1000), userResult.userId).run();
          } else {
            // プロフィール取得失敗またはusernameなし
          }
        }
      } catch {
        // プロフィール取得失敗はWebhook処理を中断させない
      }
    }

    // DM受信 = 24時間メッセージングウィンドウをオープン/更新
    const { createWindowManager } = await import("./window-manager.js");
    const windowMgr = createWindowManager({ db: env.DB, kv: env.KV });
    const windowResult = await windowMgr.updateWindow(accountId, userResult.userId);
    void windowResult;

    if (!result.stateUpdateSkipped) {
      const messageType = result.messageType ?? "unknown";
      const content = event.message?.text ?? event.postback?.title ?? null;
      const igMessageId = event.message?.mid ?? event.postback?.mid ?? null;

      await recordMessageLog(env.DB, {
        accountId,
        igUserId: userResult.userId,
        direction: "inbound",
        messageType,
        content,
        sourceType: "webhook",
        igMessageId,
      });

      try {
        const { createSurveyService } = await import("./survey-service.js");
        const surveyResult = await createSurveyService({
          db: env.DB,
          sendQueue: env.SEND_QUEUE,
        }).handleIncomingResponse({
          accountId,
          igUserId: userResult.userId,
          recipientId: event.sender.id,
          text: event.message?.text ?? null,
          payload: event.message?.quick_reply?.payload ?? event.postback?.payload ?? null,
        });
        if (surveyResult.ok && surveyResult.value.handled) {
          continue;
        }
      } catch {
        // アンケート回答処理失敗はトリガー処理を継続
      }

      // トリガーエンジン連携（DM / Postback / Ice Breaker）
      try {
        const { createTriggerEngine } = await import("./trigger-engine.js");
        const { createTriggerActionExecutor } = await import("./trigger-action-executor.js");
        const { createEnrollmentService } = await import("./enrollment-service.js");
        const { createRealInstagramClient } = await import("@gramstep/ig-sdk");
        const { getDecryptedToken } = await import("./auth-service.js");
        const { generateAppSecretProof } = await import("./crypto.js");

        const triggerEngine = createTriggerEngine({ db: env.DB });

        // イベントタイプとテキストを判定
        const triggerEvent = event.postback
          ? { type: "ice_breaker" as const, text: event.postback.payload }
          : { type: "dm" as const, text: event.message?.quick_reply?.payload ?? event.message?.text ?? "" };

        const triggerResult = await triggerEngine.evaluateTriggers(
          triggerEvent,
          accountId,
          userResult.userId,
        );

        if (triggerResult.ok && triggerResult.value.length > 0) {
          // トークン取得（メッセージ送信用）
          const tokenResult = await getDecryptedToken(accountId, {
            db: env.DB, kv: env.KV, encryptionKey: env.ENCRYPTION_KEY,
          });

          const enrollmentService = createEnrollmentService({
            db: env.DB,
            dripWorkflow: env.DRIP_WORKFLOW,
          });

          const igClient = tokenResult.ok
            ? createRealInstagramClient({
                accessToken: tokenResult.value,
                apiVersion: env.META_API_VERSION,
              })
            : new (await import("@gramstep/ig-sdk")).MockInstagramClient();

          const executor = createTriggerActionExecutor({
            db: env.DB,
            kv: env.KV,
            igClient,
            enrollmentService,
            sendQueue: env.SEND_QUEUE,
            fetchFn: fetch,
          });

          for (const match of triggerResult.value) {
            // 発火ログ記録
            await env.DB
              .prepare(
                "INSERT INTO trigger_fire_logs (id, trigger_id, ig_user_id, fired_at) VALUES (?, ?, ?, ?)",
              )
              .bind(
                crypto.randomUUID().replace(/-/g, ""),
                match.triggerId,
                userResult.userId,
                Math.floor(Date.now() / 1000),
              )
              .run();

            // アクション実行
            const ctx = {
              accountId,
              igUserId: userResult.userId,
              triggerId: match.triggerId,
              accessToken: tokenResult.ok ? tokenResult.value : "",
              appSecretProof: tokenResult.ok
                ? await generateAppSecretProof(tokenResult.value, env.META_APP_SECRET)
                : "",
              recipientId: event.sender.id,
            };
            await executor.executeActions(match.actions, ctx);

            // シナリオ登録アクションの場合、即時にステップ1をQueue送信（Workflow遅延回避）
            for (const action of match.actions) {
              if (action.type === "enroll_scenario" && action.scenarioId) {
                const steps = await env.DB
                  .prepare("SELECT step_order, delay_seconds, message_type, message_payload FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC")
                  .bind(action.scenarioId)
                  .all<{ step_order: number; delay_seconds: number; message_type: string; message_payload: string }>();

                let cumulativeDelay = 0;
                for (const s of steps.results) {
                  cumulativeDelay += s.delay_seconds > 0 ? s.delay_seconds : 0;
                  const msgId = crypto.randomUUID().replace(/-/g, "");
                  // step_order順に配信するため、各ステップの遅延を累積する
                  // さらにstep_order分の最小オフセット(1s刻み)で順序を保証
                  const delaySeconds = cumulativeDelay + (s.step_order - 1);
                  await env.SEND_QUEUE.send({
                    id: msgId,
                    accountId,
                    igUserId: userResult.userId,
                    recipientId: event.sender.id,
                    messagePayload: s.message_payload,
                    mediaCategory: s.message_type === "image" ? "image" : "text",
                    sourceType: "scenario",
                    sourceId: action.scenarioId,
                    enrollmentId: null,
                    retryCount: 0,
                  }, { delaySeconds });
                }
              }
            }
          }
        }
      } catch {
        // トリガー評価の失敗はWebhook処理全体を中断させない
      }
    }
  }
}

/**
 * entry.changes イベント処理（comments, live_comments 等）
 * Instagram Webhooks の field 購読で配信される変更イベントを処理する
 */
async function processChangeEvent(
  change: ChangeEvent,
  accountId: string,
  env: Env,
): Promise<void> {
  const db = env.DB;
  const { field, value } = change;

  if (field !== "comments" && field !== "live_comments") {
    return;
  }

  const commentId = typeof value.id === "string" ? value.id : null;
  const text = typeof value.text === "string" ? value.text : null;
  const from = value.from as { id?: string; username?: string } | undefined;
  const senderId = from?.id ?? null;

  if (!commentId) return;

  // 冪等性: INSERT OR IGNORE + changes確認で重複Webhookをスキップ
  const now = Math.floor(Date.now() / 1000);
  const dedup = await db
    .prepare(
      `INSERT OR IGNORE INTO webhook_events (event_id, account_id, event_type) VALUES (?, ?, ?)`,
    )
    .bind(`comment_${commentId}`, accountId, field)
    .run();

  if ((dedup.meta?.changes ?? 0) === 0) return; // 重複Webhook → 処理スキップ

  // コメントをメッセージログに記録（トリガー評価用）
  const { recordMessageLog } = await import("./user-registration.js");
  const { upsertIgUser } = await import("./user-registration.js");

  if (!senderId) return;

  const userResult = await upsertIgUser(db, {
    accountId,
    igScopedId: senderId,
    timestamp: now,
    igUsername: from?.username,
  });

  await recordMessageLog(db, {
    accountId,
    igUserId: userResult.userId,
    direction: "inbound",
    messageType: field,
    content: text,
    sourceType: "webhook",
    igMessageId: commentId,
  });

  // Trigger評価（comment / live_comment）
  try {
    const { createTriggerEngine } = await import("./trigger-engine.js");
    const { createTriggerActionExecutor } = await import("./trigger-action-executor.js");
    const { createEnrollmentService } = await import("./enrollment-service.js");
    const { createRealInstagramClient } = await import("@gramstep/ig-sdk");
    const { getDecryptedToken } = await import("./auth-service.js");
    const { generateAppSecretProof } = await import("./crypto.js");

    const triggerEngine = createTriggerEngine({ db });

    const triggerEvent = {
      type: (field === "comments" ? "comment" : "live_comment") as import("@gramstep/shared").TriggerType,
      text: text ?? "",
    };

    const triggerResult = await triggerEngine.evaluateTriggers(
      triggerEvent,
      accountId,
      userResult.userId,
    );

    if (triggerResult.ok && triggerResult.value.length > 0) {
      const tokenResult = await getDecryptedToken(accountId, {
        db, kv: env.KV, encryptionKey: env.ENCRYPTION_KEY,
      });

      const enrollmentService = createEnrollmentService({
        db,
        dripWorkflow: env.DRIP_WORKFLOW,
      });

      const igClient = tokenResult.ok
        ? createRealInstagramClient({
            accessToken: tokenResult.value,
            apiVersion: env.META_API_VERSION,
          })
        : new (await import("@gramstep/ig-sdk")).MockInstagramClient();

      const executor = createTriggerActionExecutor({
        db,
        kv: env.KV,
        igClient,
        enrollmentService,
        sendQueue: env.SEND_QUEUE,
        fetchFn: fetch,
      });

      for (const match of triggerResult.value) {
        const ctx = {
          accountId,
          igUserId: userResult.userId,
          triggerId: match.triggerId,
          accessToken: tokenResult.ok ? tokenResult.value : "",
          appSecretProof: tokenResult.ok
            ? await generateAppSecretProof(tokenResult.value, env.META_APP_SECRET)
            : "",
          recipientId: senderId,
          commentId,
          commentCreatedAt: now,
        };
        await executor.executeActions(match.actions, ctx);
      }
    }
  } catch {
    // Trigger評価の失敗はWebhook処理全体を中断させない
  }
}
