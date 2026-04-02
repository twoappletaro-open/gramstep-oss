import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import { ok } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface MessageDeletionInput {
  accountId: string;
  igMessageId: string;
  deletedAt: number;
}

export interface MessageDeletionResult {
  recorded: boolean;
}

export async function handleMessageDeletion(
  db: D1Database,
  input: MessageDeletionInput,
): Promise<Result<MessageDeletionResult, AppError>> {
  const updateResult = await db
    .prepare(
      `UPDATE message_logs
       SET is_deleted = 1
       WHERE ig_message_id = ? AND account_id = ?`,
    )
    .bind(input.igMessageId, input.accountId)
    .run();

  const recorded = (updateResult.meta.changes ?? 0) > 0;

  if (recorded) {
    const auditId = generateId();
    await db
      .prepare(
        `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        auditId,
        "system",
        "message_deleted",
        "message_log",
        input.igMessageId,
        JSON.stringify({ accountId: input.accountId, deletedAt: input.deletedAt }),
        input.deletedAt,
      )
      .run();
  }

  return ok({ recorded });
}
