import type { Env } from "../env.js";
import { createDataDeletionService } from "../services/data-deletion-service.js";

export type DataDeletionResult = {
  deletedUsers: number;
  deletedKvKeys: number;
  deletedR2Objects: number;
  errors: Array<{ accountId: string; message: string }>;
};

/**
 * 日次Cron（0 5 * * *）で実行:
 * - 論理削除（is_deleted=1）から30日経過後の物理削除
 * - 全ストレージ貫通（D1, KV, R2）
 * - 監査ログ証跡記録
 */
export async function handleDataDeletion(
  env: Env,
): Promise<DataDeletionResult> {
  const svc = createDataDeletionService({
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    appSecret: env.META_APP_SECRET,
  });

  const result = await svc.processPhysicalDeletion();

  if (!result.ok) {
    return {
      deletedUsers: 0,
      deletedKvKeys: 0,
      deletedR2Objects: 0,
      errors: [{ accountId: "system", message: result.error.message }],
    };
  }

  return result.value;
}
