import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import type { SyncPolicy } from "@gramstep/shared";
import {
  ok,
  err,
  createAppError,
  AccountSettingsSchema,
  SyncPolicySchema,
} from "@gramstep/shared";
import { decryptToken, generateAppSecretProof } from "./crypto.js";

// ────────── Types ──────────

export interface AccountView {
  id: string;
  igUserId: string;
  igUsername: string | null;
  timezone: string;
  healthScore: string;
  createdAt: number;
  updatedAt: number;
}

export interface AccountManagerService {
  listAccounts(): Promise<Result<AccountView[], AppError>>;
  getAccount(accountId: string): Promise<Result<AccountView, AppError>>;
  updateAccount(
    accountId: string,
    input: { timezone?: string },
  ): Promise<Result<void, AppError>>;
  deleteAccount(accountId: string): Promise<Result<void, AppError>>;
  subscribeWebhook(accountId: string): Promise<Result<void, AppError>>;
  unsubscribeWebhook(accountId: string): Promise<Result<void, AppError>>;
  getSyncPolicy(accountId: string): Promise<Result<SyncPolicy, AppError>>;
  updateSyncPolicy(
    accountId: string,
    policy: SyncPolicy,
  ): Promise<Result<void, AppError>>;
  listOperatorAccounts(
    operatorId: string,
  ): Promise<Result<Array<{ operator_id: string; account_id: string }>, AppError>>;
  grantAccess(
    operatorId: string,
    accountId: string,
  ): Promise<Result<void, AppError>>;
  revokeAccess(
    operatorId: string,
    accountId: string,
  ): Promise<Result<void, AppError>>;
  hasAccess(
    operatorId: string,
    accountId: string,
  ): Promise<Result<boolean, AppError>>;
  listAccountOperators(
    accountId: string,
  ): Promise<Result<Array<{ operator_id: string; account_id: string }>, AppError>>;
}

export interface AccountManagerDeps {
  db: D1Database;
  kv: KVNamespace;
  now: () => number;
  fetchImpl?: typeof fetch;
  metaAppSecret: string;
  metaApiVersion: string;
  encryptionKey: string;
}

// ────────── DB Row ──────────

interface AccountRow {
  id: string;
  ig_user_id: string;
  ig_username: string | null;
  access_token_encrypted: string;
  token_expires_at: number;
  timezone: string;
  settings: string;
  health_score: string;
  created_at: number;
  updated_at: number;
}

// ────────── Helpers ──────────

function toAccountView(row: AccountRow): AccountView {
  return {
    id: row.id,
    igUserId: row.ig_user_id,
    igUsername: row.ig_username,
    timezone: row.timezone,
    healthScore: row.health_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WEBHOOK_FIELDS =
  "messages,messaging_postbacks,messaging_referral,messaging_seen,message_reactions,comments,live_comments";

// ────────── Factory ──────────

export function createAccountManager(
  deps: AccountManagerDeps,
): AccountManagerService {
  const { db, now, metaAppSecret, metaApiVersion, encryptionKey } = deps;
  const fetchFn = deps.fetchImpl ?? fetch;

  function wrapD1<T>(
    fn: () => Promise<Result<T, AppError>>,
  ): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(
        createAppError(
          "D1_ERROR",
          e instanceof Error ? e.message : "Database error",
        ),
      ),
    );
  }

  async function getAccountRow(
    accountId: string,
  ): Promise<Result<AccountRow, AppError>> {
    const row = await db
      .prepare(
        `SELECT id, ig_user_id, ig_username, access_token_encrypted, token_expires_at, timezone, settings, health_score, created_at, updated_at FROM accounts WHERE id = ?`,
      )
      .bind(accountId)
      .first<AccountRow>();

    if (!row) {
      return err(createAppError("NOT_FOUND", `Account not found: ${accountId}`));
    }
    return ok(row);
  }

  async function getDecryptedTokenForAccount(
    row: AccountRow,
  ): Promise<Result<string, AppError>> {
    const decryptResult = await decryptToken(
      row.access_token_encrypted,
      encryptionKey,
    );
    if (!decryptResult.ok) {
      return err(
        createAppError("INTERNAL_ERROR", "Failed to decrypt access token"),
      );
    }
    return ok(decryptResult.value);
  }

  async function callWebhookSubscription(
    method: "POST" | "DELETE",
    igUserId: string,
    accessToken: string,
  ): Promise<Result<void, AppError>> {
    const proof = await generateAppSecretProof(accessToken, metaAppSecret);
    const url = `https://graph.instagram.com/${metaApiVersion}/${igUserId}/subscribed_apps`;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          subscribed_fields: WEBHOOK_FIELDS,
          access_token: accessToken,
          appsecret_proof: proof,
        }),
      });
    } catch (e: unknown) {
      return err(
        createAppError(
          "EXTERNAL_API_ERROR",
          `Webhook API request failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }

    if (!response.ok) {
      return err(
        createAppError(
          "EXTERNAL_API_ERROR",
          `Webhook ${method === "POST" ? "subscribe" : "unsubscribe"} failed: ${response.status}`,
        ),
      );
    }
    return ok(undefined);
  }

  return {
    listAccounts: () =>
      wrapD1(async () => {
        const result = await db
          .prepare(
            `SELECT id, ig_user_id, ig_username, access_token_encrypted, token_expires_at, timezone, settings, health_score, created_at, updated_at FROM accounts ORDER BY created_at DESC`,
          )
          .bind()
          .all<AccountRow>();

        return ok(result.results.map(toAccountView));
      }),

    getAccount: (accountId) =>
      wrapD1(async () => {
        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;
        return ok(toAccountView(rowResult.value));
      }),

    updateAccount: (accountId, input) =>
      wrapD1(async () => {
        if (input.timezone !== undefined && input.timezone.length === 0) {
          return err(
            createAppError("VALIDATION_ERROR", "Timezone must not be empty"),
          );
        }

        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;

        if (input.timezone !== undefined) {
          await db
            .prepare(`UPDATE accounts SET timezone = ?, updated_at = ? WHERE id = ?`)
            .bind(input.timezone, now(), accountId)
            .run();
        } else {
          await db
            .prepare(`UPDATE accounts SET updated_at = ? WHERE id = ?`)
            .bind(now(), accountId)
            .run();
        }

        return ok(undefined);
      }),

    deleteAccount: (accountId) =>
      wrapD1(async () => {
        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;

        // Webhook購読解除を試みる（失敗しても削除は継続）
        const tokenResult = await getDecryptedTokenForAccount(rowResult.value);
        if (tokenResult.ok) {
          await callWebhookSubscription(
            "DELETE",
            rowResult.value.ig_user_id,
            tokenResult.value,
          ).catch(() => {
            // ベストエフォート: 購読解除失敗は無視
          });
        }

        // 関連アクセス権を削除
        await db
          .prepare(`DELETE FROM operator_account_access WHERE account_id = ?`)
          .bind(accountId)
          .run();

        // アカウント削除
        await db
          .prepare(`DELETE FROM accounts WHERE id = ?`)
          .bind(accountId)
          .run();

        // KVキャッシュクリア
        await deps.kv.delete(`token:${accountId}`);
        await deps.kv.delete(`account:${accountId}:settings`);

        return ok(undefined);
      }),

    subscribeWebhook: (accountId) =>
      wrapD1(async () => {
        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;

        const tokenResult = await getDecryptedTokenForAccount(rowResult.value);
        if (!tokenResult.ok) return tokenResult;

        return callWebhookSubscription(
          "POST",
          rowResult.value.ig_user_id,
          tokenResult.value,
        );
      }),

    unsubscribeWebhook: (accountId) =>
      wrapD1(async () => {
        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;

        const tokenResult = await getDecryptedTokenForAccount(rowResult.value);
        if (!tokenResult.ok) return tokenResult;

        return callWebhookSubscription(
          "DELETE",
          rowResult.value.ig_user_id,
          tokenResult.value,
        );
      }),

    getSyncPolicy: (accountId) =>
      wrapD1(async () => {
        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;

        let settingsObj: unknown;
        try {
          settingsObj = JSON.parse(rowResult.value.settings);
        } catch {
          return ok("none" as SyncPolicy);
        }

        const parsed = AccountSettingsSchema.safeParse(settingsObj);
        if (!parsed.success) {
          return ok("none" as SyncPolicy);
        }
        return ok(parsed.data.sync_policy);
      }),

    updateSyncPolicy: (accountId, policy) =>
      wrapD1(async () => {
        const validPolicy = SyncPolicySchema.safeParse(policy);
        if (!validPolicy.success) {
          return err(
            createAppError(
              "VALIDATION_ERROR",
              `Invalid sync policy: ${policy}`,
            ),
          );
        }

        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;

        let settingsObj: Record<string, unknown>;
        try {
          settingsObj = JSON.parse(rowResult.value.settings) as Record<
            string,
            unknown
          >;
        } catch {
          settingsObj = {};
        }

        settingsObj.sync_policy = validPolicy.data;
        const newSettings = JSON.stringify(settingsObj);

        await db
          .prepare(`UPDATE accounts SET settings = ?, updated_at = ? WHERE id = ?`)
          .bind(newSettings, now(), accountId)
          .run();

        return ok(undefined);
      }),

    listOperatorAccounts: (operatorId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(
            `SELECT operator_id, account_id FROM operator_account_access WHERE operator_id = ?`,
          )
          .bind(operatorId)
          .all<{ operator_id: string; account_id: string }>();

        return ok(result.results);
      }),

    grantAccess: (operatorId, accountId) =>
      wrapD1(async () => {
        // アカウント存在確認
        const rowResult = await getAccountRow(accountId);
        if (!rowResult.ok) return rowResult;

        await db
          .prepare(
            `INSERT OR IGNORE INTO operator_account_access (operator_id, account_id) VALUES (?, ?)`,
          )
          .bind(operatorId, accountId)
          .run();

        return ok(undefined);
      }),

    revokeAccess: (operatorId, accountId) =>
      wrapD1(async () => {
        await db
          .prepare(
            `DELETE FROM operator_account_access WHERE operator_id = ? AND account_id = ?`,
          )
          .bind(operatorId, accountId)
          .run();

        return ok(undefined);
      }),

    hasAccess: (operatorId, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(
            `SELECT 1 FROM operator_account_access WHERE operator_id = ? AND account_id = ?`,
          )
          .bind(operatorId, accountId)
          .first<{ "1": number }>();

        return ok(row !== null);
      }),

    listAccountOperators: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(
            `SELECT operator_id, account_id FROM operator_account_access WHERE account_id = ?`,
          )
          .bind(accountId)
          .all<{ operator_id: string; account_id: string }>();

        return ok(result.results);
      }),
  };
}
