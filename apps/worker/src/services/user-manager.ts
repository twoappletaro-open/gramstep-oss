import { ok, err, createAppError } from "@gramstep/shared";
import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import { z } from "zod";
import type { IgUser, Tag, ScoringRule } from "@gramstep/db";
import { generateId } from "@gramstep/db";
import type { UpdateUserInput, UserFilters } from "@gramstep/shared";

export type BlockAction = "increment_count" | "schedule_retry" | "block_user" | "no_action";

export interface UserListResult {
  users: IgUser[];
  total: number;
  page: number;
  per_page: number;
}

export interface UserDetailResult {
  user: IgUser;
  tags: Tag[];
  is_test_account: boolean;
  test_account_id: string | null;
}

export interface ResetFirstTriggerHistoryResult {
  cleared: number;
  is_test_account: boolean;
}

export interface TestAccountToggleResult {
  is_test_account: boolean;
  test_account_id: string | null;
  changed: boolean;
}

// --- List ---

export async function listUsers(
  db: D1Database,
  accountId: string,
  filters: UserFilters,
): Promise<Result<UserListResult, AppError>> {
  const { whereClauses, bindings } = buildFilterClauses(accountId, filters);
  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countResult = await db
    .prepare(`SELECT COUNT(*) AS total FROM ig_users ${where}`)
    .bind(...bindings)
    .first<{ total: number }>();

  const total = countResult?.total ?? 0;
  const offset = (filters.page - 1) * filters.per_page;

  const queryResult = await db
    .prepare(
      `SELECT * FROM ig_users ${where} ORDER BY last_interaction_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, filters.per_page, offset)
    .all<IgUser>();

  return ok({
    users: queryResult.results,
    total,
    page: filters.page,
    per_page: filters.per_page,
  });
}

function buildFilterClauses(
  accountId: string,
  filters: UserFilters,
): { whereClauses: string[]; bindings: unknown[] } {
  const whereClauses: string[] = ["account_id = ?", "is_deleted = 0"];
  const bindings: unknown[] = [accountId];

  if (filters.score_min !== undefined) {
    whereClauses.push("score >= ?");
    bindings.push(filters.score_min);
  }
  if (filters.score_max !== undefined) {
    whereClauses.push("score <= ?");
    bindings.push(filters.score_max);
  }
  if (filters.follower_status !== undefined) {
    whereClauses.push("follower_status = ?");
    bindings.push(filters.follower_status);
  }
  if (filters.last_interaction_after !== undefined) {
    whereClauses.push("last_interaction_at >= ?");
    bindings.push(filters.last_interaction_after);
  }
  if (filters.is_opted_out !== undefined) {
    whereClauses.push("is_opted_out = ?");
    bindings.push(filters.is_opted_out ? 1 : 0);
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    const placeholders = filters.tags.map(() => "?").join(", ");
    whereClauses.push(
      `id IN (SELECT ig_user_id FROM ig_user_tags WHERE tag_id IN (${placeholders}))`,
    );
    bindings.push(...filters.tags);
  }

  return { whereClauses, bindings };
}

// --- Get ---

export async function getUser(
  db: D1Database,
  accountId: string,
  userId: string,
): Promise<Result<UserDetailResult, AppError>> {
  const user = await db
    .prepare("SELECT * FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<IgUser>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const tagsResult = await db
    .prepare(
      `SELECT t.* FROM tags t
       INNER JOIN ig_user_tags ut ON ut.tag_id = t.id
       WHERE ut.ig_user_id = ?`,
    )
    .bind(userId)
    .all<Tag>();

  const testAccount = await db
    .prepare("SELECT id FROM test_accounts WHERE account_id = ? AND ig_scoped_id = ?")
    .bind(accountId, user.ig_scoped_id)
    .first<{ id: string }>();

  return ok({
    user,
    tags: tagsResult.results,
    is_test_account: Boolean(testAccount),
    test_account_id: testAccount?.id ?? null,
  });
}

// --- Update ---

export async function updateUser(
  db: D1Database,
  accountId: string,
  userId: string,
  input: UpdateUserInput,
): Promise<Result<void, AppError>> {
  const existing = await db
    .prepare("SELECT id FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<{ id: string }>();

  if (!existing) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const setClauses: string[] = [];
  const bindings: unknown[] = [];

  if (input.ig_username !== undefined) {
    setClauses.push("ig_username = ?");
    bindings.push(input.ig_username);
  }
  if (input.display_name !== undefined) {
    setClauses.push("display_name = ?");
    bindings.push(input.display_name);
  }
  if (input.follower_status !== undefined) {
    setClauses.push("follower_status = ?");
    bindings.push(input.follower_status);
  }
  if (input.timezone !== undefined) {
    setClauses.push("timezone = ?");
    bindings.push(input.timezone);
  }
  if (input.preferred_delivery_hour !== undefined) {
    setClauses.push("preferred_delivery_hour = ?");
    bindings.push(input.preferred_delivery_hour);
  }

  if (setClauses.length === 0) {
    return ok(undefined);
  }

  setClauses.push("updated_at = ?");
  bindings.push(Math.floor(Date.now() / 1000));
  bindings.push(userId);

  await db
    .prepare(`UPDATE ig_users SET ${setClauses.join(", ")} WHERE id = ?`)
    .bind(...bindings)
    .run();

  return ok(undefined);
}

// --- Tags ---

export async function createTag(
  db: D1Database,
  accountId: string,
  name: string,
): Promise<Result<Tag, AppError>> {
  const id = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare("INSERT INTO tags (id, account_id, name, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, accountId, name, now)
    .run();

  return ok({ id, account_id: accountId, name, created_at: now });
}

export async function addTag(
  db: D1Database,
  accountId: string,
  userId: string,
  tagId: string,
): Promise<Result<void, AppError>> {
  const user = await db
    .prepare("SELECT id FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<{ id: string }>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const tag = await db
    .prepare("SELECT id FROM tags WHERE id = ? AND account_id = ?")
    .bind(tagId, accountId)
    .first<{ id: string }>();

  if (!tag) {
    return err(createAppError("NOT_FOUND", "Tag not found"));
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT OR IGNORE INTO ig_user_tags (ig_user_id, tag_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(userId, tagId, now)
    .run();

  return ok(undefined);
}

export async function removeTag(
  db: D1Database,
  userId: string,
  tagId: string,
): Promise<Result<void, AppError>> {
  await db
    .prepare("DELETE FROM ig_user_tags WHERE ig_user_id = ? AND tag_id = ?")
    .bind(userId, tagId)
    .run();

  return ok(undefined);
}

// --- Metadata ---

export async function updateMetadata(
  db: D1Database,
  userId: string,
  key: string,
  value: string,
): Promise<Result<void, AppError>> {
  const row = await db
    .prepare("SELECT id, metadata FROM ig_users WHERE id = ? AND is_deleted = 0")
    .bind(userId)
    .first<{ id: string; metadata: string }>();

  if (!row) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const parseResult = z.record(z.string()).safeParse(JSON.parse(row.metadata || "{}"));
  const metadata: Record<string, string> = parseResult.success ? parseResult.data : {};
  metadata[key] = value;

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE ig_users SET metadata = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(metadata), now, userId)
    .run();

  return ok(undefined);
}

// --- Scoring ---

export async function applyScoreEvent(
  db: D1Database,
  accountId: string,
  userId: string,
  eventType: string,
): Promise<Result<number, AppError>> {
  const rulesResult = await db
    .prepare(
      "SELECT * FROM scoring_rules WHERE account_id = ? AND event_type = ? AND is_active = 1",
    )
    .bind(accountId, eventType)
    .all<ScoringRule>();

  const totalDelta = rulesResult.results.reduce((sum, r) => sum + r.score_delta, 0);
  if (totalDelta === 0) {
    return ok(0);
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE ig_users SET score = score + ?, updated_at = ? WHERE id = ?")
    .bind(totalDelta, now, userId)
    .run();

  return ok(totalDelta);
}

// --- Opt-out ---

export async function setOptOut(
  db: D1Database,
  accountId: string,
  userId: string,
  optedOut: boolean,
): Promise<Result<void, AppError>> {
  const user = await db
    .prepare("SELECT id FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<{ id: string }>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE ig_users SET is_opted_out = ?, updated_at = ? WHERE id = ?")
    .bind(optedOut ? 1 : 0, now, userId)
    .run();

  return ok(undefined);
}

// --- Block Detection ---

const BLOCK_THRESHOLD = 3;
const RETRY_DELAY_SECONDS = 24 * 60 * 60; // 24h

export async function handleBlockDetection(
  db: D1Database,
  userId: string,
): Promise<Result<BlockAction, AppError>> {
  const user = await db
    .prepare(
      "SELECT id, block_error_count, block_retry_at, is_blocked FROM ig_users WHERE id = ? AND is_deleted = 0",
    )
    .bind(userId)
    .first<Pick<IgUser, "id" | "block_error_count" | "block_retry_at" | "is_blocked">>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  if (user.is_blocked) {
    return ok("no_action");
  }

  const newCount = user.block_error_count + 1;
  const now = Math.floor(Date.now() / 1000);

  // After retry (count was 3, retry was scheduled, now it's count 4+) → block
  if (newCount > BLOCK_THRESHOLD && user.block_retry_at !== null) {
    await db
      .prepare(
        "UPDATE ig_users SET is_blocked = 1, block_error_count = ?, updated_at = ? WHERE id = ?",
      )
      .bind(newCount, now, userId)
      .run();
    return ok("block_user");
  }

  // Reached threshold → schedule retry in 24h
  if (newCount >= BLOCK_THRESHOLD && user.block_retry_at === null) {
    const retryAt = now + RETRY_DELAY_SECONDS;
    await db
      .prepare(
        "UPDATE ig_users SET block_error_count = ?, block_retry_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(newCount, retryAt, now, userId)
      .run();
    return ok("schedule_retry");
  }

  // Under threshold → increment
  await db
    .prepare(
      "UPDATE ig_users SET block_error_count = ?, updated_at = ? WHERE id = ?",
    )
    .bind(newCount, now, userId)
    .run();

  return ok("increment_count");
}

// --- Manual Block/Unblock ---

export async function setBlocked(
  db: D1Database,
  accountId: string,
  userId: string,
  blocked: boolean,
): Promise<Result<void, AppError>> {
  const user = await db
    .prepare("SELECT id FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<{ id: string }>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const now = Math.floor(Date.now() / 1000);

  if (blocked) {
    await db
      .prepare("UPDATE ig_users SET is_blocked = 1, updated_at = ? WHERE id = ?")
      .bind(now, userId)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE ig_users SET is_blocked = 0, block_error_count = 0, block_retry_at = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(now, userId)
      .run();
  }

  return ok(undefined);
}

export async function resetFirstTriggerHistory(
  db: D1Database,
  accountId: string,
  userId: string,
): Promise<Result<ResetFirstTriggerHistoryResult, AppError>> {
  const user = await db
    .prepare("SELECT id, ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<Pick<IgUser, "id" | "ig_scoped_id">>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const testAccount = await db
    .prepare("SELECT id FROM test_accounts WHERE account_id = ? AND ig_scoped_id = ?")
    .bind(accountId, user.ig_scoped_id)
    .first<{ id: string }>();

  if (!testAccount) {
    return err(
      createAppError(
        "FORBIDDEN",
        "This action is only available for registered test users",
      ),
    );
  }

  const result = await db
    .prepare("DELETE FROM trigger_fire_logs WHERE ig_user_id = ?")
    .bind(userId)
    .run();

  return ok({
    cleared: result.meta.changes ?? 0,
    is_test_account: true,
  });
}

export async function registerUserAsTestAccount(
  db: D1Database,
  accountId: string,
  userId: string,
): Promise<Result<TestAccountToggleResult, AppError>> {
  const user = await db
    .prepare("SELECT id, ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<Pick<IgUser, "id" | "ig_scoped_id">>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const existing = await db
    .prepare("SELECT id FROM test_accounts WHERE account_id = ? AND ig_scoped_id = ?")
    .bind(accountId, user.ig_scoped_id)
    .first<{ id: string }>();

  if (existing) {
    return ok({
      is_test_account: true,
      test_account_id: existing.id,
      changed: false,
    });
  }

  const testAccountId = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare("INSERT INTO test_accounts (id, account_id, ig_scoped_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(testAccountId, accountId, user.ig_scoped_id, now)
    .run();

  return ok({
    is_test_account: true,
    test_account_id: testAccountId,
    changed: true,
  });
}

export async function unregisterUserAsTestAccount(
  db: D1Database,
  accountId: string,
  userId: string,
): Promise<Result<TestAccountToggleResult, AppError>> {
  const user = await db
    .prepare("SELECT id, ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<Pick<IgUser, "id" | "ig_scoped_id">>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const existing = await db
    .prepare("SELECT id FROM test_accounts WHERE account_id = ? AND ig_scoped_id = ?")
    .bind(accountId, user.ig_scoped_id)
    .first<{ id: string }>();

  if (!existing) {
    return ok({
      is_test_account: false,
      test_account_id: null,
      changed: false,
    });
  }

  await db
    .prepare("DELETE FROM test_accounts WHERE id = ? AND account_id = ?")
    .bind(existing.id, accountId)
    .run();

  return ok({
    is_test_account: false,
    test_account_id: null,
    changed: true,
  });
}
