import { generateId } from "@gramstep/db";
import type { MessagingWindow } from "@gramstep/db";
import { AccountSettingsSchema } from "@gramstep/shared";
import type { SendQueueMessage } from "@gramstep/shared";

export const RE_ENGAGEMENT_THRESHOLD_SECONDS = 7200; // 2時間

const QUICK_REPLY_PAYLOAD = JSON.stringify({
  type: "quick_reply",
  text: "まだお話ししたいことがあればお気軽にどうぞ！",
  quick_replies: [
    { content_type: "text", title: "続きを読む", payload: "RE_ENGAGE_CONTINUE" },
  ],
});

export interface ReEngagementResult {
  processed: number;
  errors: Array<{ accountId: string; message: string }>;
}

export interface ReEngagementDeps {
  db: D1Database;
  sendQueue: Queue;
}

interface ReEngagementServiceInterface {
  execute(): Promise<ReEngagementResult>;
}

export function createReEngagementService(
  deps: ReEngagementDeps,
): ReEngagementServiceInterface {
  const { db, sendQueue } = deps;

  return {
    async execute(): Promise<ReEngagementResult> {
      const result: ReEngagementResult = { processed: 0, errors: [] };

      // 全アカウント取得
      const accountsResult = await db
        .prepare("SELECT id, settings FROM accounts")
        .bind()
        .all<{ id: string; settings: string }>();

      const accounts = accountsResult.results ?? [];

      for (const account of accounts) {
        // settings解析 → re_engagement_enabled チェック
        let enabled = false;
        try {
          const parsed = AccountSettingsSchema.parse(JSON.parse(account.settings));
          enabled = parsed.re_engagement_enabled;
        } catch {
          // 不正なJSON or スキーマ不一致 → スキップ
          continue;
        }

        if (!enabled) {
          continue;
        }

        // 期限切れ間近 かつ 未送信のアクティブウィンドウ取得
        const now = Math.floor(Date.now() / 1000);
        const threshold = now + RE_ENGAGEMENT_THRESHOLD_SECONDS;

        const windowsResult = await db
          .prepare(
            `SELECT id, account_id, ig_user_id, window_opened_at, window_expires_at, is_active, re_engagement_sent
             FROM messaging_windows
             WHERE account_id = ?
               AND is_active = 1
               AND re_engagement_sent = 0
               AND window_expires_at > ?
               AND window_expires_at <= ?`,
          )
          .bind(account.id, now, threshold)
          .all<MessagingWindow>();

        const windows = windowsResult.results ?? [];

        for (const w of windows) {
          // ig_userのig_scoped_idを取得（送信先）
          const igUser = await db
            .prepare("SELECT ig_scoped_id FROM ig_users WHERE id = ?")
            .bind(w.ig_user_id)
            .first<{ ig_scoped_id: string }>();

          if (!igUser) {
            result.errors.push({
              accountId: account.id,
              message: `ig_user not found: ${w.ig_user_id}`,
            });
            continue;
          }

          // Quick ReplyメッセージをQueue送信
          const msg: SendQueueMessage = {
            id: generateId(),
            accountId: account.id,
            igUserId: w.ig_user_id,
            recipientId: igUser.ig_scoped_id,
            messagePayload: QUICK_REPLY_PAYLOAD,
            mediaCategory: "text",
            sourceType: "system",
            sourceId: null,
            enrollmentId: null,
            retryCount: 0,
          };

          try {
            await sendQueue.send(msg);

            // re_engagement_sentフラグを立てる（同一ウィンドウ1回制限）
            await db
              .prepare(
                "UPDATE messaging_windows SET re_engagement_sent = 1 WHERE id = ?",
              )
              .bind(w.id)
              .run();

            result.processed++;
          } catch (e) {
            result.errors.push({
              accountId: account.id,
              message: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      return result;
    },
  };
}
