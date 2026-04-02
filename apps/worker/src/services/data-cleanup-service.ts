import { executeRun, executeQuery, executeFirst } from "@gramstep/db";
import type { MessageLog } from "@gramstep/db";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

// ────────── Types ──────────

export interface DataCleanupDeps {
  db: D1Database;
  r2: R2Bucket;
}

export interface ArchiveResult {
  archivedCount: number;
  deletedFromD1: number;
}

export interface DeleteResult {
  deletedCount: number;
}

export interface RetentionPolicyResult {
  policies: Array<{ name: string; deletedCount: number }>;
}

export interface CapacityResult {
  usedBytes: number;
  maxBytes: number;
  usagePercent: number;
  warningLevel: "normal" | "warning" | "critical";
}

export interface CleanupSummary {
  archivedMessages: number;
  deletedWebhookEvents: number;
  retentionPolicies: Array<{ name: string; deletedCount: number }>;
  d1Capacity: CapacityResult;
}

export interface DataCleanupService {
  archiveOldMessageLogs(): Promise<Result<ArchiveResult, AppError>>;
  deleteOldWebhookEvents(): Promise<Result<DeleteResult, AppError>>;
  applyRetentionPolicies(): Promise<Result<RetentionPolicyResult, AppError>>;
  checkD1Capacity(): Promise<Result<CapacityResult, AppError>>;
  runFullCleanup(): Promise<Result<CleanupSummary, AppError>>;
}

// ────────── Constants ──────────

const MESSAGE_LOG_RETENTION_DAYS = 30;
const WEBHOOK_EVENT_RETENTION_DAYS = 7;
const SCORE_HISTORY_RETENTION_DAYS = 180;
const AUTOMATION_LOG_RETENTION_DAYS = 60;
const HEALTH_LOG_RETENTION_DAYS = 30;
const D1_MAX_BYTES = 500 * 1024 * 1024; // 500MB
const BATCH_SIZE = 100;

// ────────── Factory ──────────

export function createDataCleanupService(deps: DataCleanupDeps): DataCleanupService {
  const { db, r2 } = deps;

  function cutoffTimestamp(days: number): number {
    return Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  }

  return {
    async archiveOldMessageLogs() {
      const cutoff = cutoffTimestamp(MESSAGE_LOG_RETENTION_DAYS);
      let archivedCount = 0;
      let deletedFromD1 = 0;

      // Fetch old logs in batches
      const logsResult = await executeQuery<MessageLog>(
        db,
        "SELECT * FROM message_logs WHERE created_at < ? ORDER BY created_at ASC LIMIT ?",
        cutoff,
        BATCH_SIZE,
      );

      if (!logsResult.ok) {
        return err(createAppError("D1_ERROR", logsResult.error.message));
      }

      const logs = logsResult.value.results ?? [];

      // Group by account_id and date for R2 archival
      const grouped = new Map<string, MessageLog[]>();
      for (const log of logs) {
        const date = new Date(log.created_at * 1000);
        const dateStr = date.toISOString().slice(0, 10);
        const monthStr = date.toISOString().slice(0, 7);
        const key = `archive/${log.account_id}/messages/${monthStr}/${dateStr}`;
        const existing = grouped.get(key) ?? [];
        existing.push(log);
        grouped.set(key, existing);
      }

      // Write to R2 as JSONL files
      for (const [key, records] of grouped) {
        const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
        await r2.put(`${key}.jsonl`, jsonl, {
          httpMetadata: { contentType: "application/x-ndjson" },
        });
        archivedCount += records.length;
      }

      // Delete archived records from D1
      if (logs.length > 0) {
        const ids = logs.map((l) => l.id);
        const placeholders = ids.map(() => "?").join(",");
        const deleteResult = await executeRun(
          db,
          `DELETE FROM message_logs WHERE id IN (${placeholders})`,
          ...ids,
        );
        if (deleteResult.ok) {
          deletedFromD1 = (deleteResult.value.meta as { changes?: number })?.changes ?? 0;
        }
      }

      return ok({ archivedCount, deletedFromD1 });
    },

    async deleteOldWebhookEvents() {
      const cutoff = cutoffTimestamp(WEBHOOK_EVENT_RETENTION_DAYS);

      const result = await executeRun(
        db,
        "DELETE FROM webhook_events WHERE processed_at < ?",
        cutoff,
      );

      if (!result.ok) {
        return err(createAppError("D1_ERROR", result.error.message));
      }

      const deletedCount = (result.value.meta as { changes?: number })?.changes ?? 0;
      return ok({ deletedCount });
    },

    async applyRetentionPolicies() {
      const policies: Array<{ name: string; deletedCount: number }> = [];

      // Score history: 180 days
      const scoreResult = await executeRun(
        db,
        "DELETE FROM scoring_rules WHERE is_active = 0 AND created_at < ?",
        cutoffTimestamp(SCORE_HISTORY_RETENTION_DAYS),
      );
      policies.push({
        name: "score_history_180d",
        deletedCount: scoreResult.ok
          ? ((scoreResult.value.meta as { changes?: number })?.changes ?? 0)
          : 0,
      });

      // Automation logs (trigger_fire_logs): 60 days
      const autoResult = await executeRun(
        db,
        "DELETE FROM trigger_fire_logs WHERE fired_at < ?",
        cutoffTimestamp(AUTOMATION_LOG_RETENTION_DAYS),
      );
      policies.push({
        name: "automation_logs_60d",
        deletedCount: autoResult.ok
          ? ((autoResult.value.meta as { changes?: number })?.changes ?? 0)
          : 0,
      });

      // Workflow checkpoints (completed): 30 days
      const healthResult = await executeRun(
        db,
        "DELETE FROM workflow_checkpoints WHERE status IN ('resumed', 'cancelled') AND created_at < ?",
        cutoffTimestamp(HEALTH_LOG_RETENTION_DAYS),
      );
      policies.push({
        name: "completed_checkpoints_30d",
        deletedCount: healthResult.ok
          ? ((healthResult.value.meta as { changes?: number })?.changes ?? 0)
          : 0,
      });

      return ok({ policies });
    },

    async checkD1Capacity() {
      const result = await executeFirst<{ page_count: number; page_size: number }>(
        db,
        "PRAGMA page_count; PRAGMA page_size",
      );

      // Fallback: try separate pragmas
      let usedBytes = 0;
      if (result.ok && result.value) {
        usedBytes = result.value.page_count * result.value.page_size;
      }

      const usagePercent = (usedBytes / D1_MAX_BYTES) * 100;
      let warningLevel: "normal" | "warning" | "critical" = "normal";
      if (usagePercent >= 90) {
        warningLevel = "critical";
      } else if (usagePercent >= 75) {
        warningLevel = "warning";
      }

      return ok({
        usedBytes,
        maxBytes: D1_MAX_BYTES,
        usagePercent: Math.round(usagePercent * 100) / 100,
        warningLevel,
      });
    },

    async runFullCleanup() {
      const archiveResult = await this.archiveOldMessageLogs();
      const webhookResult = await this.deleteOldWebhookEvents();
      const retentionResult = await this.applyRetentionPolicies();
      const capacityResult = await this.checkD1Capacity();

      if (!capacityResult.ok) {
        return err(capacityResult.error);
      }

      return ok({
        archivedMessages: archiveResult.ok ? archiveResult.value.archivedCount : 0,
        deletedWebhookEvents: webhookResult.ok ? webhookResult.value.deletedCount : 0,
        retentionPolicies: retentionResult.ok ? retentionResult.value.policies : [],
        d1Capacity: capacityResult.value,
      });
    },
  };
}
