import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import type { MessageLog } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import type { DeliveryStatus } from "@gramstep/shared";

// --- 状態遷移の順序定義 ---

const STATUS_ORDER: Record<DeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: -1, // failed は終端状態
};

function isValidTransition(
  current: DeliveryStatus,
  next: DeliveryStatus,
): boolean {
  if (current === next) return true; // 冪等
  if (current === "failed") return false; // failed からは遷移不可
  if (next === "failed") return true; // failed への遷移は常に許可
  return STATUS_ORDER[current] < STATUS_ORDER[next];
}

// --- updateDeliveryStatus ---

export async function updateDeliveryStatus(
  db: D1Database,
  messageLogId: string,
  newStatus: DeliveryStatus,
): Promise<Result<{ updated: boolean }, AppError>> {
  const existing = await db
    .prepare("SELECT id, delivery_status FROM message_logs WHERE id = ?")
    .bind(messageLogId)
    .first<{ id: string; delivery_status: string }>();

  if (!existing) {
    return err(createAppError("NOT_FOUND", `Message log not found: ${messageLogId}`));
  }

  const currentStatus = existing.delivery_status as DeliveryStatus;

  if (currentStatus === newStatus) {
    return ok({ updated: false }); // 冪等: 同じステータスなら成功だが更新なし
  }

  if (!isValidTransition(currentStatus, newStatus)) {
    return err(
      createAppError("VALIDATION_ERROR", `Invalid status transition: ${currentStatus} → ${newStatus}`, {
        currentStatus,
        newStatus,
      }),
    );
  }

  await db
    .prepare("UPDATE message_logs SET delivery_status = ? WHERE id = ?")
    .bind(newStatus, messageLogId)
    .run();

  return ok({ updated: true });
}

// --- handleMessagingSeen ---

export interface MessagingSeenInput {
  accountId: string;
  igUserId: string;
  watermark: number;
}

export interface MessagingSeenResult {
  updatedCount: number;
}

export async function handleMessagingSeen(
  db: D1Database,
  input: MessagingSeenInput,
): Promise<Result<MessagingSeenResult, AppError>> {
  // watermarkはミリ秒タイムスタンプ。created_atはunixepoch（秒）なので変換
  const watermarkSeconds = Math.floor(input.watermark / 1000);

  const result = await db
    .prepare(
      `UPDATE message_logs
       SET delivery_status = 'read'
       WHERE account_id = ?
         AND ig_user_id = ?
         AND direction = 'outbound'
         AND delivery_status != 'read'
         AND delivery_status != 'failed'
         AND created_at <= ?`,
    )
    .bind(input.accountId, input.igUserId, watermarkSeconds)
    .run();

  return ok({ updatedCount: result.meta.changes ?? 0 });
}

// --- searchMessageLogs ---

export interface MessageLogFilters {
  accountId: string;
  igUserId?: string;
  keyword?: string;
  dateFrom?: number;
  dateTo?: number;
  messageType?: string;
  sourceType?: string;
  direction?: string;
  deliveryStatus?: string;
  excludeTest?: boolean;
  page?: number;
  perPage?: number;
}

export interface MessageLogSearchResult {
  logs: MessageLog[];
  total: number;
  page: number;
  perPage: number;
}

export async function searchMessageLogs(
  db: D1Database,
  filters: MessageLogFilters,
): Promise<Result<MessageLogSearchResult, AppError>> {
  const page = filters.page ?? 1;
  const perPage = filters.perPage ?? 20;
  const offset = (page - 1) * perPage;

  const conditions: string[] = ["account_id = ?"];
  const bindings: unknown[] = [filters.accountId];

  if (filters.igUserId) {
    conditions.push("ig_user_id = ?");
    bindings.push(filters.igUserId);
  }

  if (filters.keyword) {
    conditions.push("content LIKE ?");
    bindings.push(`%${filters.keyword}%`);
  }

  if (filters.dateFrom !== undefined) {
    conditions.push("created_at >= ?");
    bindings.push(filters.dateFrom);
  }

  if (filters.dateTo !== undefined) {
    conditions.push("created_at <= ?");
    bindings.push(filters.dateTo);
  }

  if (filters.messageType) {
    conditions.push("message_type = ?");
    bindings.push(filters.messageType);
  }

  if (filters.sourceType) {
    conditions.push("source_type = ?");
    bindings.push(filters.sourceType);
  }

  if (filters.direction) {
    conditions.push("direction = ?");
    bindings.push(filters.direction);
  }

  if (filters.deliveryStatus) {
    conditions.push("delivery_status = ?");
    bindings.push(filters.deliveryStatus);
  }

  if (filters.excludeTest) {
    conditions.push("is_test = 0");
  }

  const whereClause = conditions.join(" AND ");

  // COUNT クエリ
  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM message_logs WHERE ${whereClause}`)
    .bind(...bindings)
    .first<{ total: number }>();

  const total = countResult?.total ?? 0;

  // データ取得クエリ
  const dataResult = await db
    .prepare(
      `SELECT * FROM message_logs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, perPage, offset)
    .all<MessageLog>();

  return ok({
    logs: dataResult.results,
    total,
    page,
    perPage,
  });
}
