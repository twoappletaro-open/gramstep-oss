import type { Env } from "../env.js";
import type { IInstagramClient } from "@gramstep/ig-sdk";
import { createAppError, err, ok } from "@gramstep/shared";
import type { AppError, Result } from "@gramstep/shared";

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
  executionCtx?: ExecutionContext,
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
  type MessagingContext = {
    accessToken: string;
    appSecretProof: string;
    igClient: IInstagramClient;
  };

  let messagingContextPromise: Promise<Result<MessagingContext, AppError>> | null = null;
  function defer(task: Promise<unknown>): void {
    const safeTask = task.catch(() => undefined);
    if (executionCtx) {
      executionCtx.waitUntil(safeTask);
      return;
    }
    void safeTask;
  }

  async function getMessagingContext(): Promise<Result<MessagingContext, AppError>> {
    if (messagingContextPromise) {
      return messagingContextPromise;
    }

    messagingContextPromise = (async () => {
      const [{ getResolvedAppContext }, sdk] = await Promise.all([
        import("./app-failover.js"),
        import("@gramstep/ig-sdk"),
      ]);

      let appContext;
      try {
        appContext = await getResolvedAppContext(env, accountId);
      } catch (error) {
        return err(
          createAppError(
            "INTERNAL_ERROR",
            error instanceof Error ? error.message : "Access token not available",
          ),
        );
      }

      return ok({
        accessToken: appContext.accessToken,
        appSecretProof: appContext.appSecretProof,
        igClient: sdk.createRealInstagramClient({
          accessToken: appContext.accessToken,
          apiVersion: env.META_API_VERSION,
        }),
      });
    })();

    return messagingContextPromise;
  }

  async function sendDemoEntryFallback(
    recipientId: string,
    igUserId: string,
  ): Promise<void> {
    if (accountId !== "acc_default") {
      return;
    }

    const contextResult = await getMessagingContext();
    if (!contextResult.ok) {
      console.error("[Webhook] demo fallback skipped: messaging context unavailable", contextResult.error);
      return;
    }

    const sendResult = await contextResult.value.igClient.sendMessage(
      igUserId,
      {
        recipientId,
        message: {
          type: "quick_reply",
          text: "デモと打ってみてください。",
          quickReplies: [
            { contentType: "text", title: "デモ", payload: "デモ" },
          ],
        },
      },
      contextResult.value.appSecretProof,
    );

    if (!sendResult.ok) {
      console.error("[Webhook] failed to send demo fallback", sendResult.error);
    }
  }

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
    void getMessagingContext();

    if (!result.stateUpdateSkipped) {
      const messageType = result.messageType ?? "unknown";
      const content = event.message?.text ?? event.postback?.title ?? null;
      const igMessageId = event.message?.mid ?? event.postback?.mid ?? null;

      defer(recordMessageLog(env.DB, {
        accountId,
        igUserId: userResult.userId,
        direction: "inbound",
        messageType,
        content,
        sourceType: "webhook",
        igMessageId,
      }));

      try {
        const { createSurveyService } = await import("./survey-service.js");
        const surveyResult = await createSurveyService({
          db: env.DB,
          sendQueue: env.SEND_QUEUE,
          sendImmediate: async ({ messageId, igUserId, recipientId, message }) => {
            const contextResult = await getMessagingContext();
            if (!contextResult.ok) {
              return err(createAppError("INTERNAL_ERROR", contextResult.error.message));
            }
            const sendResult = await contextResult.value.igClient.sendMessage(
              igUserId,
              { recipientId, message },
              contextResult.value.appSecretProof,
            );
            if (!sendResult.ok) {
              return err(createAppError("INSTAGRAM_API_ERROR", sendResult.error.message));
            }
            await env.DB
              .prepare("UPDATE message_logs SET delivery_status = 'sent', ig_message_id = ? WHERE id = ?")
              .bind(sendResult.value.messageId, messageId)
              .run()
              .catch(() => undefined);
            return ok(undefined);
          },
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
      } catch (error) {
        console.error("[Webhook] survey response handling failed", error);
        // アンケート回答処理失敗はトリガー処理を継続
      }

      try {
        const { parsePackageButtonPayload } = await import("./package-format.js");
        const packagePayload = parsePackageButtonPayload(
          event.message?.quick_reply?.payload ?? event.postback?.payload ?? null,
        );
        if (packagePayload) {
          const contextResult = await getMessagingContext();
          if (contextResult.ok) {
            const { createEnrollmentService } = await import("./enrollment-service.js");
            const { createPackageButtonExecutor } = await import("./package-button-executor.js");

            const enrollmentService = createEnrollmentService({
              db: env.DB,
              dripWorkflow: env.DRIP_WORKFLOW,
              sendImmediate: async ({ messageId, igUserId, recipientId, message }) => {
                const sendResult = await contextResult.value.igClient.sendMessage(
                  igUserId,
                  { recipientId, message },
                  contextResult.value.appSecretProof,
                );
                if (!sendResult.ok) {
                  return err(createAppError("INSTAGRAM_API_ERROR", sendResult.error.message));
                }
                await env.DB
                  .prepare("UPDATE message_logs SET delivery_status = 'sent', ig_message_id = ? WHERE id = ?")
                  .bind(sendResult.value.messageId, messageId)
                  .run()
                  .catch(() => undefined);
                return ok(undefined);
              },
            });

            await createPackageButtonExecutor({
              db: env.DB,
              kv: env.KV,
              igClient: contextResult.value.igClient,
              enrollmentService,
              sendQueue: env.SEND_QUEUE,
              fetchFn: fetch,
            }).handle({
              accountId,
              igUserId: userResult.userId,
              recipientId: event.sender.id,
              payload: event.message?.quick_reply?.payload ?? event.postback?.payload ?? null,
              accessToken: contextResult.value.accessToken,
              appSecretProof: contextResult.value.appSecretProof,
            });
            continue;
          }
        }
      } catch (error) {
        console.error("[Webhook] package button handling failed", error);
        // パッケージボタン処理失敗でも通常トリガー処理へフォールスルーする
      }

      // トリガーエンジン連携（DM / Postback / Ice Breaker）
      try {
        const { createTriggerEngine } = await import("./trigger-engine.js");
        const { createTriggerActionExecutor } = await import("./trigger-action-executor.js");
        const { createEnrollmentService } = await import("./enrollment-service.js");

        const triggerEngine = createTriggerEngine({ db: env.DB, kv: env.KV });

        // イベントタイプとテキストを判定
        const triggerEvent = event.postback
          ? { type: "ice_breaker" as const, text: event.postback.payload }
          : { type: "dm" as const, text: event.message?.quick_reply?.payload ?? event.message?.text ?? "" };

        const triggerResult = await triggerEngine.evaluateTriggers(
          triggerEvent,
          accountId,
          userResult.userId,
        );

        if (!triggerResult.ok) {
          console.error("[Webhook] trigger evaluation failed", triggerResult.error);
        } else {
          console.log("[Webhook] trigger matches", {
            accountId,
            igUserId: userResult.userId,
            eventType: triggerEvent.type,
            text: triggerEvent.text,
            count: triggerResult.value.length,
            triggerIds: triggerResult.value.map((match) => match.triggerId),
          });
        }

        if (triggerResult.ok && triggerResult.value.length > 0) {
          const contextResult = await getMessagingContext();

          const enrollmentService = createEnrollmentService({
            db: env.DB,
            dripWorkflow: env.DRIP_WORKFLOW,
            sendImmediate: async ({ messageId, igUserId, recipientId, message }) => {
              if (!contextResult.ok) {
                return err(createAppError("INTERNAL_ERROR", "Access token not available"));
              }
              const sendResult = await contextResult.value.igClient.sendMessage(
                igUserId,
                { recipientId, message },
                contextResult.value.appSecretProof,
              );
              if (!sendResult.ok) {
                return err(createAppError("INSTAGRAM_API_ERROR", sendResult.error.message));
              }
              await env.DB
                .prepare("UPDATE message_logs SET delivery_status = 'sent', ig_message_id = ? WHERE id = ?")
                .bind(sendResult.value.messageId, messageId)
                .run()
                .catch(() => undefined);
              return ok(undefined);
            },
          });

          const igClient = contextResult.ok
            ? contextResult.value.igClient
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
              accessToken: contextResult.ok ? contextResult.value.accessToken : "",
              appSecretProof: contextResult.ok ? contextResult.value.appSecretProof : "",
              recipientId: event.sender.id,
            };
            await executor.executeActions(match.actions, ctx);
          }
        } else if (
          triggerResult.ok
          && triggerEvent.type === "dm"
          && !event.message?.quick_reply
          && (event.message?.text ?? "").trim().length > 0
        ) {
          await sendDemoEntryFallback(event.sender.id, userResult.userId);
        }
      } catch (error) {
        console.error("[Webhook] trigger handling failed", error);
        // トリガー評価の失敗はWebhook処理全体を中断させない
      }
    }

    defer((async () => {
      const { createWindowManager } = await import("./window-manager.js");
      const windowMgr = createWindowManager({ db: env.DB, kv: env.KV });
      await windowMgr.updateWindow(accountId, userResult.userId);
    })());

    defer((async () => {
      const existingProfile = await env.DB.prepare(
        "SELECT ig_username FROM ig_users WHERE id = ?",
      ).bind(userResult.userId).first<{ ig_username: string | null }>();
      const needsProfile = userResult.isNew || !existingProfile?.ig_username;
      if (!needsProfile) {
        return;
      }

      const contextResult = await getMessagingContext();
      if (!contextResult.ok) {
        return;
      }
      const profileResult = await contextResult.value.igClient.getUserProfile(
        event.sender.id,
        contextResult.value.accessToken,
        contextResult.value.appSecretProof,
      );
      if (!profileResult.ok || !profileResult.value.username) {
        return;
      }

      const p = profileResult.value;
      const rawFollowerFlag = p.is_user_follow_business ?? p.isUserFollowingBusiness;
      const followerStatus = rawFollowerFlag === true
        ? "following"
        : rawFollowerFlag === false
          ? "not_following"
          : "unknown";
      await env.DB.prepare(
        "UPDATE ig_users SET ig_username = ?, display_name = ?, follower_status = ?, updated_at = ? WHERE id = ?",
      ).bind(p.username ?? null, p.name ?? p.username ?? null, followerStatus, Math.floor(Date.now() / 1000), userResult.userId).run();
    })());
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
    const { getResolvedAppContext } = await import("./app-failover.js");

    const triggerEngine = createTriggerEngine({ db, kv: env.KV });

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
      let appContext;
      try {
        appContext = await getResolvedAppContext(env, accountId);
      } catch {
        appContext = null;
      }

      const enrollmentService = createEnrollmentService({
        db,
        dripWorkflow: env.DRIP_WORKFLOW,
        sendImmediate: async ({ messageId, igUserId, recipientId, message }) => {
          if (!appContext) {
            return err(createAppError("INTERNAL_ERROR", "Access token not available"));
          }
          const sendResult = await igClient.sendMessage(
            igUserId,
            { recipientId, message },
            appContext.appSecretProof,
          );
          if (!sendResult.ok) {
            return err(createAppError("INSTAGRAM_API_ERROR", sendResult.error.message));
          }
          await db
            .prepare("UPDATE message_logs SET delivery_status = 'sent', ig_message_id = ? WHERE id = ?")
            .bind(sendResult.value.messageId, messageId)
            .run()
            .catch(() => undefined);
          return ok(undefined);
        },
      });

      const igClient = appContext
        ? createRealInstagramClient({
            accessToken: appContext.accessToken,
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
          accessToken: appContext?.accessToken ?? "",
          appSecretProof: appContext?.appSecretProof ?? "",
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
