import type { Result } from "@gramstep/shared";
import type { AppError, CreateApiKeyInput, UpdateApiKeyInput } from "@gramstep/shared";
import type { ApiKey } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface ApiKeyView {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  scopes: string[];
  expires_at: number | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface ApiKeyCreateResult {
  key: ApiKeyView;
  raw_key: string;
}

export interface ApiKeyManagerService {
  create(accountId: string, input: CreateApiKeyInput): Promise<Result<ApiKeyCreateResult, AppError>>;
  list(accountId: string): Promise<Result<ApiKeyView[], AppError>>;
  get(keyId: string, accountId: string): Promise<Result<ApiKeyView, AppError>>;
  update(keyId: string, accountId: string, input: UpdateApiKeyInput): Promise<Result<ApiKeyView, AppError>>;
  revoke(keyId: string, accountId: string): Promise<Result<void, AppError>>;
  rotate(keyId: string, accountId: string): Promise<Result<ApiKeyCreateResult, AppError>>;
  deleteKey(keyId: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface ApiKeyManagerDeps {
  db: D1Database;
  now: () => number;
}

function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "idk_" + Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toView(row: ApiKey): ApiKeyView {
  let scopes: string[] = [];
  try {
    scopes = JSON.parse(row.scopes) as string[];
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    description: row.description,
    scopes,
    expires_at: row.expires_at,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createApiKeyManager(deps: ApiKeyManagerDeps): ApiKeyManagerService {
  const { db, now } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    create: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const rawKey = generateRawKey();
        const keyHash = await hashKey(rawKey);
        const timestamp = now();
        const scopesJson = JSON.stringify(input.scopes);
        const expiresAt = input.expires_in_days
          ? timestamp + input.expires_in_days * 86400
          : null;

        await db
          .prepare(
            `INSERT INTO api_keys (id, account_id, name, description, key_hash, scopes, expires_at, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, accountId, input.name, input.description ?? null, keyHash, scopesJson, expiresAt, timestamp, timestamp)
          .run();

        return ok({
          key: {
            id,
            account_id: accountId,
            name: input.name,
            description: input.description ?? null,
            scopes: input.scopes,
            expires_at: expiresAt,
            is_active: true,
            created_at: timestamp,
            updated_at: timestamp,
          },
          raw_key: rawKey,
        });
      }),

    list: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM api_keys WHERE account_id = ? ORDER BY created_at DESC`)
          .bind(accountId)
          .all<ApiKey>();
        return ok(result.results.map(toView));
      }),

    get: (keyId, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM api_keys WHERE id = ? AND account_id = ?`)
          .bind(keyId, accountId)
          .first<ApiKey>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "APIキーが見つかりません"));
        }
        return ok(toView(row));
      }),

    update: (keyId, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM api_keys WHERE id = ? AND account_id = ?`)
          .bind(keyId, accountId)
          .first<ApiKey>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "APIキーが見つかりません"));
        }

        const updated = {
          name: input.name ?? existing.name,
          description: input.description !== undefined ? input.description : existing.description,
          scopes: input.scopes ? JSON.stringify(input.scopes) : existing.scopes,
          is_active: input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        };
        const timestamp = now();

        await db
          .prepare(
            `UPDATE api_keys SET name = ?, description = ?, scopes = ?, is_active = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
          )
          .bind(updated.name, updated.description, updated.scopes, updated.is_active, timestamp, keyId, accountId)
          .run();

        return ok(toView({ ...existing, ...updated, updated_at: timestamp }));
      }),

    revoke: (keyId, accountId) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT id FROM api_keys WHERE id = ? AND account_id = ?`)
          .bind(keyId, accountId)
          .first<{ id: string }>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "APIキーが見つかりません"));
        }

        await db
          .prepare(`UPDATE api_keys SET is_active = 0, updated_at = ? WHERE id = ? AND account_id = ?`)
          .bind(now(), keyId, accountId)
          .run();
        return ok(undefined);
      }),

    rotate: (keyId, accountId) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM api_keys WHERE id = ? AND account_id = ?`)
          .bind(keyId, accountId)
          .first<ApiKey>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "APIキーが見つかりません"));
        }

        // Revoke old key
        const timestamp = now();
        await db
          .prepare(`UPDATE api_keys SET is_active = 0, updated_at = ? WHERE id = ? AND account_id = ?`)
          .bind(timestamp, keyId, accountId)
          .run();

        // Create new key with same settings
        const newId = generateId();
        const rawKey = generateRawKey();
        const keyHash = await hashKey(rawKey);

        await db
          .prepare(
            `INSERT INTO api_keys (id, account_id, name, description, key_hash, scopes, expires_at, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(newId, accountId, existing.name, existing.description, keyHash, existing.scopes, existing.expires_at, timestamp, timestamp)
          .run();

        let scopes: string[] = [];
        try {
          scopes = JSON.parse(existing.scopes) as string[];
        } catch {
          scopes = [];
        }

        return ok({
          key: {
            id: newId,
            account_id: accountId,
            name: existing.name,
            description: existing.description,
            scopes,
            expires_at: existing.expires_at,
            is_active: true,
            created_at: timestamp,
            updated_at: timestamp,
          },
          raw_key: rawKey,
        });
      }),

    deleteKey: (keyId, accountId) =>
      wrapD1(async () => {
        await db
          .prepare(`DELETE FROM api_keys WHERE id = ? AND account_id = ?`)
          .bind(keyId, accountId)
          .run();
        return ok(undefined);
      }),
  };
}
