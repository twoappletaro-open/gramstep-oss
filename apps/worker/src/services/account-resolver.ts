import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import type { AccountSettings } from "@gramstep/shared";
import { ok, err, createAppError, AccountSettingsSchema } from "@gramstep/shared";

export interface ResolvedAccount {
  id: string;
  igUserId: string;
  timezone: string;
  healthScore: string;
}

export interface AccountResolverService {
  resolveByIgUserId(igUserId: string): Promise<Result<ResolvedAccount, AppError>>;
  resolveWebhookEntryAccountId(entryId: string): Promise<Result<string, AppError>>;
  getAccountSettings(accountId: string): Promise<Result<AccountSettings, AppError>>;
}

export interface AccountResolverDeps {
  db: D1Database;
  kv: KVNamespace;
}

interface AccountRow {
  id: string;
  ig_user_id: string;
  timezone: string;
  health_score: string;
  settings: string;
}

const CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_PREFIX = "acct_resolve:";

// インメモリキャッシュ（KV write削減: 同一isolate内で再利用）
const memoryCache = new Map<string, { row: AccountRow; expiresAt: number }>();
const MEMORY_CACHE_TTL_MS = 60_000; // 1分
const MAX_MEMORY_CACHE_SIZE = 1000;

/** テスト用: メモリキャッシュをクリア */
export function clearAccountResolverCache(): void {
  memoryCache.clear();
}

export function createAccountResolver(deps: AccountResolverDeps): AccountResolverService {
  const { db, kv } = deps;

  async function lookupByIgUserId(igUserId: string): Promise<Result<AccountRow, AppError>> {
    try {
      // 1. インメモリキャッシュ
      const memCached = memoryCache.get(igUserId);
      if (memCached && memCached.expiresAt > Date.now()) {
        return ok(memCached.row);
      }

      // 2. KVキャッシュ
      const cached = await kv.get(`${CACHE_PREFIX}${igUserId}`);
      if (cached) {
        const row = JSON.parse(cached) as AccountRow;
        if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE) memoryCache.clear();
        memoryCache.set(igUserId, { row, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS });
        return ok(row);
      }

      // 3. D1
      const row = await db
        .prepare(
          `SELECT id, ig_user_id, timezone, health_score, settings FROM accounts WHERE ig_user_id = ?`,
        )
        .bind(igUserId)
        .first<AccountRow>();

      if (!row) {
        return err(createAppError("NOT_FOUND", `Account not found for ig_user_id: ${igUserId}`));
      }

      // KVキャッシュ + メモリキャッシュ書込み
      memoryCache.set(igUserId, { row, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS });
      await kv.put(`${CACHE_PREFIX}${igUserId}`, JSON.stringify(row), {
        expirationTtl: CACHE_TTL_SECONDS,
      });

      return ok(row);
    } catch (e: unknown) {
      return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Account lookup failed"));
    }
  }

  return {
    async resolveByIgUserId(igUserId) {
      const result = await lookupByIgUserId(igUserId);
      if (!result.ok) return result;

      const row = result.value;
      return ok({
        id: row.id,
        igUserId: row.ig_user_id,
        timezone: row.timezone,
        healthScore: row.health_score,
      });
    },

    async resolveWebhookEntryAccountId(entryId) {
      const result = await lookupByIgUserId(entryId);
      if (!result.ok) return result;
      return ok(result.value.id);
    },

    async getAccountSettings(accountId) {
      try {
        const row = await db
          .prepare(`SELECT id, ig_user_id, timezone, health_score, settings FROM accounts WHERE id = ?`)
          .bind(accountId)
          .first<AccountRow>();

        if (!row) {
          return err(createAppError("NOT_FOUND", `Account not found: ${accountId}`));
        }

        let settingsObj: unknown;
        try {
          settingsObj = JSON.parse(row.settings);
        } catch {
          return err(createAppError("VALIDATION_ERROR", "Invalid JSON in account settings"));
        }

        const parsed = AccountSettingsSchema.safeParse(settingsObj);
        if (!parsed.success) {
          return err(createAppError("VALIDATION_ERROR", `Invalid account settings: ${parsed.error.message}`));
        }
        return ok(parsed.data);
      } catch (e: unknown) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Settings lookup failed"));
      }
    },
  };
}
