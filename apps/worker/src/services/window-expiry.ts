import type { MessagingWindow, ScenarioEnrollment } from "@gramstep/db";
import type { Result } from "@gramstep/shared";
import { ok, type AppError } from "@gramstep/shared";

const HUMAN_AGENT_WINDOW_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface ExpireResult {
  expiredCount: number;
}

export interface ResumeResult {
  resumedCount: number;
}

export type WindowExpiryError = AppError;

export interface WindowExpiryService {
  expireWindows(): Promise<Result<ExpireResult, WindowExpiryError>>;
  resumeExpiredEnrollments(igUserId: string, accountId: string): Promise<Result<ResumeResult, WindowExpiryError>>;
  isHumanAgentWindowActive(accountId: string, igUserId: string): Promise<boolean>;
}

export interface WindowExpiryDeps {
  db: D1Database;
  kv: KVNamespace;
}

export function createWindowExpiryService(deps: WindowExpiryDeps): WindowExpiryService {
  const { db, kv } = deps;

  return {
    async expireWindows() {
      const now = Math.floor(Date.now() / 1000);

      // Find all active windows past expiry
      const expired = await db
        .prepare(
          `SELECT id, account_id, ig_user_id, window_opened_at, window_expires_at, is_active, re_engagement_sent
           FROM messaging_windows
           WHERE is_active = 1 AND window_expires_at < ?`,
        )
        .bind(now)
        .all<MessagingWindow>();

      const windows = expired.results ?? [];
      let expiredCount = 0;

      for (const w of windows) {
        // Deactivate window
        await db
          .prepare("UPDATE messaging_windows SET is_active = 0 WHERE id = ?")
          .bind(w.id)
          .run();

        // Update active enrollments to window_expired
        await db
          .prepare(
            "UPDATE scenario_enrollments SET status = 'window_expired' WHERE ig_user_id = ? AND account_id = ? AND status = 'active'",
          )
          .bind(w.ig_user_id, w.account_id)
          .run();

        // Invalidate KV cache
        await kv.delete(`window:${w.account_id}:${w.ig_user_id}`);

        expiredCount++;
      }

      return ok({ expiredCount });
    },

    async resumeExpiredEnrollments(igUserId, accountId) {
      // Find all window_expired enrollments for this user
      const result = await db
        .prepare(
          `SELECT id, scenario_id, ig_user_id, account_id, current_step_order, workflow_instance_id, status, started_at, completed_at
           FROM scenario_enrollments
           WHERE ig_user_id = ? AND account_id = ? AND status = 'window_expired'`,
        )
        .bind(igUserId, accountId)
        .all<ScenarioEnrollment>();

      const enrollments = result.results ?? [];
      let resumedCount = 0;

      for (const e of enrollments) {
        await db
          .prepare("UPDATE scenario_enrollments SET status = ? WHERE id = ?")
          .bind("active", e.id)
          .run();
        resumedCount++;
      }

      return ok({ resumedCount });
    },

    async isHumanAgentWindowActive(accountId, igUserId) {
      const now = Math.floor(Date.now() / 1000);

      // HUMAN_AGENT tag allows 7-day window from last interaction (window_opened_at)
      const row = await db
        .prepare(
          `SELECT id, account_id, ig_user_id, window_opened_at, window_expires_at, is_active, re_engagement_sent
           FROM messaging_windows
           WHERE account_id = ? AND ig_user_id = ?`,
        )
        .bind(accountId, igUserId)
        .first<MessagingWindow>();

      if (!row) {
        return false;
      }

      // HUMAN_AGENT window: 7 days from window_opened_at
      return row.window_opened_at + HUMAN_AGENT_WINDOW_SECONDS > now;
    },
  };
}
