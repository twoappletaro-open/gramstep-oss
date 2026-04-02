import type { Env } from "../env.js";
import { createAuditLogService } from "../services/audit-log-service.js";
import { createDataCleanupService } from "../services/data-cleanup-service.js";

export type AuditLogPurgeResult = {
  deletedCount: number;
  error: string | null;
  cleanup: {
    archivedMessages: number;
    deletedWebhookEvents: number;
    retentionPolicies: Array<{ name: string; deletedCount: number }>;
    d1WarningLevel: string;
  } | null;
};

/**
 * 日次Cron（0 4 * * *）で実行:
 * - 監査ログ365日超パージ
 * - メッセージログR2アーカイブ
 * - webhook_events 7日超削除
 * - 保持ポリシー適用（スコア180日・自動化60日・チェックポイント30日）
 * - D1容量500MB監視
 */
export async function handleAuditLogPurge(
  env: Env,
): Promise<AuditLogPurgeResult> {
  const auditSvc = createAuditLogService({ db: env.DB });
  const result = await auditSvc.purgeExpired();

  const deletedCount = result.ok ? result.value.deletedCount : 0;
  const error = result.ok ? null : result.error.message;

  // Run data cleanup
  const cleanupSvc = createDataCleanupService({ db: env.DB, r2: env.R2 });
  const cleanupResult = await cleanupSvc.runFullCleanup();

  return {
    deletedCount,
    error,
    cleanup: cleanupResult.ok
      ? {
          archivedMessages: cleanupResult.value.archivedMessages,
          deletedWebhookEvents: cleanupResult.value.deletedWebhookEvents,
          retentionPolicies: cleanupResult.value.retentionPolicies,
          d1WarningLevel: cleanupResult.value.d1Capacity.warningLevel,
        }
      : null,
  };
}
