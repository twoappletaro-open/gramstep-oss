import { generateId } from "@gramstep/db";

export interface UpsertUserInput {
  accountId: string;
  igScopedId: string;
  timestamp: number;
  igUsername?: string;
  displayName?: string;
  followerStatus?: string;
}

export interface UpsertUserResult {
  userId: string;
  isNew: boolean;
}

export async function upsertIgUser(
  db: D1Database,
  input: UpsertUserInput,
): Promise<UpsertUserResult> {
  const existing = await db
    .prepare("SELECT id FROM ig_users WHERE account_id = ? AND ig_scoped_id = ?")
    .bind(input.accountId, input.igScopedId)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        "UPDATE ig_users SET last_interaction_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(input.timestamp, input.timestamp, existing.id)
      .run();

    return { userId: existing.id, isNew: false };
  }

  const id = generateId();
  await db
    .prepare(
      `INSERT INTO ig_users (id, account_id, ig_scoped_id, ig_username, display_name, follower_status, last_interaction_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.accountId,
      input.igScopedId,
      input.igUsername ?? null,
      input.displayName ?? null,
      input.followerStatus ?? "unknown",
      input.timestamp,
      input.timestamp,
      input.timestamp,
    )
    .run();

  return { userId: id, isNew: true };
}

export interface MessageLogInput {
  accountId: string;
  igUserId: string;
  direction: string;
  messageType: string;
  content: string | null;
  sourceType: string;
  sourceId?: string;
  igMessageId: string | null;
  isTest?: boolean;
}

export async function recordMessageLog(
  db: D1Database,
  input: MessageLogInput,
): Promise<void> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO message_logs (id, account_id, ig_user_id, direction, message_type, content, source_type, source_id, ig_message_id, is_test)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.accountId,
      input.igUserId,
      input.direction,
      input.messageType,
      input.content,
      input.sourceType,
      input.sourceId ?? null,
      input.igMessageId,
      input.isTest ? 1 : 0,
    )
    .run();
}
