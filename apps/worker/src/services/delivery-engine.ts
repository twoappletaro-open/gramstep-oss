import type {
  Result,
  AppError,
  SendQueueMessage,
  MediaCategory,
} from "@gramstep/shared";
import {
  ok,
  err,
  createAppError,
  IG_API_ERROR_CODES,
  isRetryableIgError,
} from "@gramstep/shared";
import type { IInstagramClient, IgApiError, MessagePayload } from "@gramstep/ig-sdk";
import type { RateLimiterService } from "./rate-limiter.js";
import type { WindowManagerService } from "./window-manager.js";
import { createWindowExpiryService } from "./window-expiry.js";
import { recordMessageLog } from "./user-registration.js";

export const BACKOFF_BASE_MS = 1000;
export const MAX_RETRIES = 5;

export interface DeliveryEngineService {
  processMessage(msg: SendQueueMessage): Promise<Result<void, AppError>>;
  processBatch(messages: SendQueueMessage[]): Promise<Result<void, AppError>[]>;
}

export interface DeliveryEngineDeps {
  igClient: IInstagramClient;
  rateLimiter: RateLimiterService;
  windowManager: WindowManagerService;
  db: D1Database;
  kv: KVNamespace;
  sendQueue: Queue<SendQueueMessage>;
  dlq: Queue<SendQueueMessage>;
  appSecretProof: string;
}

function jitter(): number {
  return Math.floor(Math.random() * 1000);
}

async function lookupCachedAttachmentId(
  db: D1Database,
  accountId: string,
  mediaUrlHash: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT attachment_id FROM attachment_cache WHERE account_id = ? AND media_url_hash = ?",
    )
    .bind(accountId, mediaUrlHash)
    .first<{ attachment_id: string }>();
  return row?.attachment_id ?? null;
}

async function cacheAttachmentId(
  db: D1Database,
  accountId: string,
  mediaUrlHash: string,
  attachmentId: string,
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT OR IGNORE INTO attachment_cache (id, account_id, media_url_hash, attachment_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, accountId, mediaUrlHash, attachmentId, now)
    .run();
}

function resolveMessagePayload(
  payload: MessagePayload,
  cachedAttachmentId: string | null,
): MessagePayload {
  if (
    payload.type === "image" &&
    cachedAttachmentId !== null
  ) {
    return { ...payload, attachmentId: cachedAttachmentId };
  }
  return payload;
}

export function createDeliveryEngine(deps: DeliveryEngineDeps): DeliveryEngineService {
  const {
    igClient,
    rateLimiter,
    windowManager,
    db,
    kv,
    sendQueue,
    dlq,
    appSecretProof,
  } = deps;
  const windowExpiry = createWindowExpiryService({ db, kv });

  async function requeue(msg: SendQueueMessage, incrementRetry: boolean): Promise<void> {
    const nextRetry = incrementRetry ? msg.retryCount + 1 : msg.retryCount;
    const updated: SendQueueMessage = {
      ...msg,
      retryCount: nextRetry,
    };
    // 指数バックオフ + ジッター（retryCount=0→1s, 1→2s, 2→4s, 3→8s, 4→16s + jitter）
    // レート制限リキュー（incrementRetry=false）は短い固定遅延
    const delaySeconds = incrementRetry
      ? Math.min(Math.floor((BACKOFF_BASE_MS * Math.pow(2, msg.retryCount) + jitter()) / 1000), 60)
      : 1;
    await sendQueue.send(updated, { delaySeconds });
  }

  async function moveToDlq(msg: SendQueueMessage): Promise<void> {
    await dlq.send(msg);
  }

  async function updateMessageLog(
    messageId: string,
    deliveryStatus: "sent" | "failed",
    igMessageId?: string,
  ): Promise<void> {
    await db
      .prepare(
        "UPDATE message_logs SET delivery_status = ?, ig_message_id = COALESCE(?, ig_message_id) WHERE id = ?",
      )
      .bind(deliveryStatus, igMessageId ?? null, messageId)
      .run();
  }

  async function handleIgApiError(
    igError: IgApiError,
    msg: SendQueueMessage,
  ): Promise<Result<void, AppError>> {
    const code = igError.code;

    // #190 Token expired — alert, no retry
    if (code === IG_API_ERROR_CODES.TOKEN_EXPIRED) {
      await updateMessageLog(msg.id, "failed");
      return err(
        createAppError("TOKEN_EXPIRED", `Token expired for account ${msg.accountId}`, {
          igErrorCode: code,
        }),
      );
    }

    // #551 Window expired — no retry
    if (code === IG_API_ERROR_CODES.WINDOW_EXPIRED) {
      await updateMessageLog(msg.id, "failed");
      return err(
        createAppError("WINDOW_EXPIRED", `Window expired for user ${msg.igUserId}`, {
          igErrorCode: code,
        }),
      );
    }

    // #100 Invalid param — DLQ, no retry
    if (code === IG_API_ERROR_CODES.INVALID_PARAM) {
      await moveToDlq(msg);
      await updateMessageLog(msg.id, "failed");
      return err(
        createAppError("INSTAGRAM_API_ERROR", `Invalid param: ${igError.message}`, {
          igErrorCode: code,
        }),
      );
    }

    // #10 Permission denied — track block count
    if (code === IG_API_ERROR_CODES.PERMISSION_DENIED) {
      await updateBlockErrorCount(msg.igUserId);
      await updateMessageLog(msg.id, "failed");
      return err(
        createAppError("INSTAGRAM_API_ERROR", `Permission denied for user ${msg.igUserId}`, {
          igErrorCode: code,
        }),
      );
    }

    // #613, #2 — retryable errors
    if (isRetryableIgError(code)) {
      if (msg.retryCount >= MAX_RETRIES) {
        await moveToDlq(msg);
        await updateMessageLog(msg.id, "failed");
        return err(
          createAppError("INSTAGRAM_API_ERROR", `Max retries exceeded: ${igError.message}`, {
            igErrorCode: code,
            retryCount: msg.retryCount,
          }),
        );
      }
      await requeue(msg, true);
      return err(
        createAppError("INSTAGRAM_API_ERROR", `Retrying: ${igError.message}`, {
          igErrorCode: code,
          retryCount: msg.retryCount + 1,
        }),
      );
    }

    // Unknown IG error — DLQ
    await moveToDlq(msg);
    await updateMessageLog(msg.id, "failed");
    return err(
      createAppError("INSTAGRAM_API_ERROR", `Unknown IG error: ${igError.message}`, {
        igErrorCode: code,
      }),
    );
  }

  async function updateBlockErrorCount(igUserId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "UPDATE ig_users SET block_error_count = block_error_count + 1, block_retry_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(now + 86400, now, igUserId)
      .run();
  }

  async function processMessage(msg: SendQueueMessage): Promise<Result<void, AppError>> {
    // 1. Rate limit check
    const canSend = await rateLimiter.canSend(msg.accountId, msg.mediaCategory as MediaCategory);
    if (!canSend) {
      await requeue(msg, false);
      return err(
        createAppError("RATE_LIMITED", `Rate limited for account ${msg.accountId}`),
      );
    }

    // 1.5. Campaign dispatch pre-check: skip if dispatch or campaign is cancelled/paused
    if (msg.dispatchId) {
      const dispatch = await db
        .prepare(
          "SELECT d.status AS d_status, c.status AS c_status FROM campaign_dispatches d JOIN campaigns c ON d.campaign_id = c.id WHERE d.id = ?",
        )
        .bind(msg.dispatchId)
        .first<{ d_status: string; c_status: string }>();
      if (
        dispatch &&
        (dispatch.d_status === "cancelled" ||
          dispatch.c_status === "cancelled" ||
          dispatch.c_status === "paused")
      ) {
        return ok(undefined);
      }
    }

    // 2. Window validity check
    const standardWindowActive = await windowManager.isWindowActive(msg.accountId, msg.igUserId);
    const humanAgentWindowActive = msg.tag === "HUMAN_AGENT"
      ? await windowExpiry.isHumanAgentWindowActive(msg.accountId, msg.igUserId)
      : false;
    const windowActive = standardWindowActive || humanAgentWindowActive;
    if (!windowActive) {
      if (msg.dispatchId) {
        await db
          .prepare(
            "UPDATE campaign_dispatches SET status = 'skipped', skip_reason = 'window_expired' WHERE id = ?",
          )
          .bind(msg.dispatchId)
          .run();
      }
      await updateMessageLog(msg.id, "failed");
      return err(
        createAppError("WINDOW_EXPIRED", `Window expired for user ${msg.igUserId}`),
      );
    }

    // 3. Send typing_on
    await igClient.sendAction(msg.igUserId, "typing_on", msg.recipientId, appSecretProof);

    // 4. Resolve message payload (attachment_id cache)
    let payload: MessagePayload = JSON.parse(msg.messagePayload) as MessagePayload;
    if (payload.type === "image" && msg.mediaUrlHash) {
      const cachedId = await lookupCachedAttachmentId(db, msg.accountId, msg.mediaUrlHash);
      payload = resolveMessagePayload(payload, cachedId);
    }

    // 5. Send message (HUMAN_AGENT タグがあれば付与して7日ウィンドウで送信)
    const sendResult = await igClient.sendMessage(
      msg.igUserId,
      { recipientId: msg.recipientId, message: payload, ...(msg.tag ? { tag: msg.tag } : {}) },
      appSecretProof,
    );

    if (!sendResult.ok) {
      if (msg.dispatchId) {
        const nowTs = Math.floor(Date.now() / 1000);
        await db
          .prepare(
            "UPDATE campaign_dispatches SET status = 'failed', failed_at = ?, error_message = ? WHERE id = ?",
          )
          .bind(nowTs, sendResult.error.message, msg.dispatchId)
          .run();

        // TOKEN_EXPIRED: pause all active/dispatching campaigns + notify
        if (sendResult.error.code === IG_API_ERROR_CODES.TOKEN_EXPIRED) {
          await db
            .prepare(
              `UPDATE campaigns SET status = 'paused', paused_reason = 'token_expired', updated_at = ?
               WHERE account_id = ? AND status IN ('active', 'dispatching')`,
            )
            .bind(nowTs, msg.accountId)
            .run();
          const notifId = crypto.randomUUID().replace(/-/g, "");
          await db
            .prepare(
              `INSERT INTO notifications (id, account_id, rule_id, event_type, level, title, body, is_read, created_at)
               VALUES (?, ?, NULL, 'token_expired', 'critical', ?, ?, 0, ?)`,
            )
            .bind(
              notifId,
              msg.accountId,
              "トークン期限切れ",
              "Instagramトークンが期限切れのため、関連キャンペーンを一時停止しました。再認証後にキャンペーンを再開してください。",
              nowTs,
            )
            .run();
        }
      }
      return handleIgApiError(sendResult.error, msg);
    }

    // 6. Record send for rate limiting
    await rateLimiter.recordSend(msg.accountId, msg.mediaCategory as MediaCategory);

    // 7. Cache attachment_id if returned
    const response = sendResult.value as Record<string, unknown>;
    if (
      payload.type === "image" &&
      msg.mediaUrlHash &&
      typeof response.attachmentId === "string"
    ) {
      await cacheAttachmentId(db, msg.accountId, msg.mediaUrlHash, response.attachmentId);
    }

    await updateMessageLog(
      msg.id,
      "sent",
      typeof response.messageId === "string" ? response.messageId : undefined,
    );

    // 8. Send mark_seen
    await igClient.sendAction(msg.igUserId, "mark_seen", msg.recipientId, appSecretProof);

    // 9. Campaign dispatch success: update status + record message log
    if (msg.dispatchId) {
      const nowTs = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          "UPDATE campaign_dispatches SET status = 'sent', sent_at = ? WHERE id = ?",
        )
        .bind(nowTs, msg.dispatchId)
        .run();
      await recordMessageLog(db, {
        accountId: msg.accountId,
        igUserId: msg.igUserId,
        direction: "outbound",
        messageType: "text",
        content: null,
        sourceType: "campaign",
        sourceId: msg.sourceId ?? undefined,
        igMessageId:
          typeof response.messageId === "string" ? response.messageId : null,
      });
    }

    return ok(undefined);
  }

  return {
    processMessage,

    async processBatch(messages) {
      const results: Result<void, AppError>[] = [];
      for (const msg of messages) {
        results.push(await processMessage(msg));
      }
      return results;
    },
  };
}
