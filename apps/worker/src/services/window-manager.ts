import { generateId } from "@gramstep/db";
import type { MessagingWindow } from "@gramstep/db";
import type { Result } from "@gramstep/shared";
import { ok, err, type AppError, createAppError } from "@gramstep/shared";

export const WINDOW_DURATION_SECONDS = 24 * 60 * 60; // 24 hours
export const WINDOW_KV_TTL_SECONDS = 300; // 5 minutes

export interface WindowInfo {
  id: string;
  accountId: string;
  igUserId: string;
  windowOpenedAt: number;
  windowExpiresAt: number;
  isActive: boolean;
}

export type WindowError = AppError;

export interface WindowManagerService {
  updateWindow(accountId: string, igUserId: string): Promise<Result<WindowInfo, WindowError>>;
  isWindowActive(accountId: string, igUserId: string): Promise<boolean>;
  getExpiringWindows(accountId: string, thresholdMinutes: number): Promise<WindowInfo[]>;
}

/**
 * KV read-throughを使わずD1のみでウィンドウ確認する関数（bulk dispatch用）。
 * Cron campaign-dispatcherから呼ばれ、KV write回数を節約する。
 */
export async function isWindowActiveDirect(
  db: D1Database,
  accountId: string,
  igUserId: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      "SELECT is_active, window_expires_at FROM messaging_windows WHERE account_id = ? AND ig_user_id = ?",
    )
    .bind(accountId, igUserId)
    .first<{ is_active: number; window_expires_at: number }>();

  if (!row) {
    return false;
  }

  return row.is_active === 1 && row.window_expires_at > now;
}

export interface WindowDeps {
  db: D1Database;
  kv: KVNamespace;
}

function toWindowInfo(row: MessagingWindow): WindowInfo {
  return {
    id: row.id,
    accountId: row.account_id,
    igUserId: row.ig_user_id,
    windowOpenedAt: row.window_opened_at,
    windowExpiresAt: row.window_expires_at,
    isActive: row.is_active === 1,
  };
}

function kvKey(accountId: string, igUserId: string): string {
  return `window:${accountId}:${igUserId}`;
}

export function createWindowManager(deps: WindowDeps): WindowManagerService {
  const { db, kv } = deps;

  return {
    async updateWindow(accountId, igUserId) {
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + WINDOW_DURATION_SECONDS;

      // Check for existing window to preserve id
      const existing = await db
        .prepare(
          "SELECT id FROM messaging_windows WHERE account_id = ? AND ig_user_id = ?",
        )
        .bind(accountId, igUserId)
        .first<{ id: string }>();

      const id = existing?.id ?? generateId();

      console.log("[WindowManager] updateWindow called", { accountId, igUserId, id, existingId: existing?.id ?? null });

      let result: D1Result;
      try {
        result = await db
          .prepare(
            `INSERT OR REPLACE INTO messaging_windows (id, account_id, ig_user_id, window_opened_at, window_expires_at, is_active, re_engagement_sent)
             VALUES (?, ?, ?, ?, ?, 1, 0)`,
          )
          .bind(id, accountId, igUserId, now, expiresAt)
          .run();
      } catch (e) {
        console.error("[WindowManager] D1 INSERT threw", e);
        return err(createAppError("D1_ERROR", `D1 INSERT threw: ${e}`));
      }

      console.log("[WindowManager] D1 result", { success: result.success, changes: result.meta?.changes });

      if (!result.success) {
        console.error("[WindowManager] D1 INSERT failed", { success: result.success });
        return err(createAppError("D1_ERROR", "Failed to update messaging window"));
      }

      // Invalidate KV cache (Read-through: Write-through不使用)
      await kv.delete(kvKey(accountId, igUserId));

      return ok({
        id,
        accountId,
        igUserId,
        windowOpenedAt: now,
        windowExpiresAt: expiresAt,
        isActive: true,
      });
    },

    async isWindowActive(accountId, igUserId) {
      const key = kvKey(accountId, igUserId);
      const now = Math.floor(Date.now() / 1000);

      // Try KV cache first (Read-through)
      const cached = await kv.get(key);
      if (cached !== null) {
        const row = JSON.parse(cached) as MessagingWindow;
        return row.is_active === 1 && row.window_expires_at > now;
      }

      // Fall through to D1
      const row = await db
        .prepare(
          "SELECT id, account_id, ig_user_id, window_opened_at, window_expires_at, is_active, re_engagement_sent FROM messaging_windows WHERE account_id = ? AND ig_user_id = ?",
        )
        .bind(accountId, igUserId)
        .first<MessagingWindow>();

      if (!row) {
        return false;
      }

      const isActive = row.is_active === 1 && row.window_expires_at > now;
      // KV write抑制: アクティブなウィンドウのみキャッシュ（期限切れはキャッシュ不要）
      if (isActive) {
        await kv.put(key, JSON.stringify(row), { expirationTtl: WINDOW_KV_TTL_SECONDS });
      }

      return isActive;
    },

    async getExpiringWindows(accountId, thresholdMinutes) {
      const now = Math.floor(Date.now() / 1000);
      const threshold = now + thresholdMinutes * 60;

      const result = await db
        .prepare(
          `SELECT id, account_id, ig_user_id, window_opened_at, window_expires_at, is_active, re_engagement_sent
           FROM messaging_windows
           WHERE account_id = ? AND is_active = 1 AND window_expires_at <= ?`,
        )
        .bind(accountId, threshold)
        .all<MessagingWindow>();

      return (result.results ?? []).map(toWindowInfo);
    },
  };
}
