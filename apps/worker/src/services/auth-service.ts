import type { Result } from "@gramstep/shared";
import { ok, err } from "@gramstep/shared";
import { executeFirst, executeRun, generateId } from "@gramstep/db";
import type { Account } from "@gramstep/db";
import {
  encryptToken,
  decryptToken,
  generateAppSecretProof,
} from "./crypto.js";

export type OAuthError = {
  code:
    | "OAUTH_STATE_MISMATCH"
    | "OAUTH_TOKEN_EXCHANGE_FAILED"
    | "OAUTH_CALLBACK_FAILED";
  message: string;
};

export type TokenError = {
  code: "TOKEN_NOT_FOUND" | "TOKEN_DECRYPT_FAILED";
  message: string;
};

export type RefreshError = {
  code: "REFRESH_FAILED" | "ACCOUNT_NOT_FOUND";
  message: string;
};

export interface AuthServiceDeps {
  db: D1Database;
  kv: KVNamespace;
  metaAppId: string;
  metaAppSecret: string;
  encryptionKey: string;
  metaApiVersion: string;
  dashboardUrl: string;
  fetcher?: typeof fetch;
}

const OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];

const KV_TOKEN_TTL = 3600; // 1時間
const KV_OAUTH_STATE_TTL = 600; // 10分

export function initiateOAuth(
  deps: Pick<AuthServiceDeps, "metaAppId">,
  redirectUri: string,
): { authorizationUrl: string; state: string } {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: deps.metaAppId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES.join(","),
    response_type: "code",
    state,
  });
  return {
    authorizationUrl: `https://www.instagram.com/oauth/authorize?${params.toString()}`,
    state,
  };
}

export async function saveOAuthState(
  kv: KVNamespace,
  state: string,
): Promise<void> {
  await kv.put(`oauth_state:${state}`, "pending", {
    expirationTtl: KV_OAUTH_STATE_TTL,
  });
}

export async function handleCallback(
  code: string,
  state: string,
  redirectUri: string,
  deps: AuthServiceDeps,
): Promise<Result<Account, OAuthError>> {
  const fetchFn = deps.fetcher ?? fetch;

  // state検証
  const storedState = await deps.kv.get(`oauth_state:${state}`);
  if (storedState === null) {
    return err({
      code: "OAUTH_STATE_MISMATCH",
      message: "Invalid or expired OAuth state",
    });
  }
  await deps.kv.delete(`oauth_state:${state}`);

  // 認証コード → 短期トークン交換
  const tokenResponse = await fetchFn(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: deps.metaAppId,
        client_secret: deps.metaAppSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    },
  );

  if (!tokenResponse.ok) {
    return err({
      code: "OAUTH_TOKEN_EXCHANGE_FAILED",
      message: `Token exchange failed: ${tokenResponse.status}`,
    });
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    user_id: number;
  };

  // 短期 → 長期トークン交換
  const longTokenParams = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: deps.metaAppSecret,
    access_token: tokenData.access_token,
  });
  const longTokenResponse = await fetchFn(
    `https://graph.instagram.com/access_token?${longTokenParams.toString()}`,
  );

  if (!longTokenResponse.ok) {
    return err({
      code: "OAUTH_TOKEN_EXCHANGE_FAILED",
      message: `Long-term token exchange failed: ${longTokenResponse.status}`,
    });
  }

  const longTokenData = (await longTokenResponse.json()) as {
    access_token: string;
    expires_in: number;
  };

  // ユーザー情報取得
  const appSecretProof = await generateAppSecretProof(
    longTokenData.access_token,
    deps.metaAppSecret,
  );
  const meParams = new URLSearchParams({
    fields: "user_id,username",
    access_token: longTokenData.access_token,
    appsecret_proof: appSecretProof,
  });
  const meResponse = await fetchFn(
    `https://graph.instagram.com/${deps.metaApiVersion}/me?${meParams.toString()}`,
  );

  const meData = meResponse.ok
    ? ((await meResponse.json()) as { user_id: string; username?: string })
    : { user_id: String(tokenData.user_id), username: undefined };

  // トークン暗号化
  const encryptResult = await encryptToken(
    longTokenData.access_token,
    deps.encryptionKey,
  );
  if (!encryptResult.ok) {
    return err({
      code: "OAUTH_CALLBACK_FAILED",
      message: "Failed to encrypt token",
    });
  }

  // D1保存（UPSERT）
  const accountId = generateId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + longTokenData.expires_in;

  const insertResult = await executeRun(
    deps.db,
    `INSERT INTO accounts (id, ig_user_id, ig_username, access_token_encrypted, token_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ig_user_id) DO UPDATE SET
       ig_username = excluded.ig_username,
       access_token_encrypted = excluded.access_token_encrypted,
       token_expires_at = excluded.token_expires_at,
       updated_at = excluded.updated_at`,
    accountId,
    meData.user_id,
    meData.username ?? null,
    encryptResult.value,
    expiresAt,
    now,
    now,
  );

  if (!insertResult.ok) {
    return err({
      code: "OAUTH_CALLBACK_FAILED",
      message: insertResult.error.message,
    });
  }

  // 実際のアカウントを取得（ON CONFLICT時は既存ID）
  const accountResult = await executeFirst<Account>(
    deps.db,
    "SELECT * FROM accounts WHERE ig_user_id = ?",
    meData.user_id,
  );

  if (!accountResult.ok || accountResult.value === null) {
    return err({
      code: "OAUTH_CALLBACK_FAILED",
      message: "Failed to retrieve account",
    });
  }

  const account = accountResult.value;

  // KVトークンキャッシュ
  await deps.kv.put(`token:${account.id}`, encryptResult.value, {
    expirationTtl: KV_TOKEN_TTL,
  });

  // Webhook購読
  const subProof = await generateAppSecretProof(
    longTokenData.access_token,
    deps.metaAppSecret,
  );
  await fetchFn(
    `https://graph.instagram.com/${deps.metaApiVersion}/${meData.user_id}/subscribed_apps`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields:
          "messages,messaging_postbacks,messaging_referral,messaging_seen,message_reactions",
        access_token: longTokenData.access_token,
        appsecret_proof: subProof,
      }),
    },
  );

  return ok(account);
}

export async function getDecryptedToken(
  accountId: string,
  deps: Pick<AuthServiceDeps, "db" | "kv" | "encryptionKey">,
): Promise<Result<string, TokenError>> {
  // KVキャッシュ確認
  const cached = await deps.kv.get(`token:${accountId}`);
  if (cached !== null) {
    const decryptResult = await decryptToken(cached, deps.encryptionKey);
    if (decryptResult.ok) {
      return ok(decryptResult.value);
    }
  }

  // D1フォールバック
  const accountResult = await executeFirst<Account>(
    deps.db,
    "SELECT * FROM accounts WHERE id = ?",
    accountId,
  );

  if (!accountResult.ok) {
    return err({
      code: "TOKEN_NOT_FOUND",
      message: accountResult.error.message,
    });
  }

  if (accountResult.value === null) {
    return err({ code: "TOKEN_NOT_FOUND", message: "Account not found" });
  }

  const decryptResult = await decryptToken(
    accountResult.value.access_token_encrypted,
    deps.encryptionKey,
  );
  if (!decryptResult.ok) {
    return err({
      code: "TOKEN_DECRYPT_FAILED",
      message: decryptResult.error.message,
    });
  }

  // KVにキャッシュ書込み
  await deps.kv.put(
    `token:${accountId}`,
    accountResult.value.access_token_encrypted,
    { expirationTtl: KV_TOKEN_TTL },
  );

  return ok(decryptResult.value);
}

export async function refreshToken(
  accountId: string,
  deps: AuthServiceDeps,
): Promise<Result<void, RefreshError>> {
  const fetchFn = deps.fetcher ?? fetch;

  // 現在のトークン取得
  const tokenResult = await getDecryptedToken(accountId, deps);
  if (!tokenResult.ok) {
    return err({
      code: "ACCOUNT_NOT_FOUND",
      message: tokenResult.error.message,
    });
  }

  // Instagram APIでリフレッシュ
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: tokenResult.value,
  });
  const response = await fetchFn(
    `https://graph.instagram.com/refresh_access_token?${params.toString()}`,
  );

  if (!response.ok) {
    return err({
      code: "REFRESH_FAILED",
      message: `Refresh API returned ${response.status}`,
    });
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  // 新トークン暗号化
  const encryptResult = await encryptToken(data.access_token, deps.encryptionKey);
  if (!encryptResult.ok) {
    return err({
      code: "REFRESH_FAILED",
      message: "Failed to encrypt refreshed token",
    });
  }

  // D1更新
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + data.expires_in;
  const updateResult = await executeRun(
    deps.db,
    "UPDATE accounts SET access_token_encrypted = ?, token_expires_at = ?, updated_at = ? WHERE id = ?",
    encryptResult.value,
    expiresAt,
    now,
    accountId,
  );

  if (!updateResult.ok) {
    return err({
      code: "REFRESH_FAILED",
      message: updateResult.error.message,
    });
  }

  // KVキャッシュ更新
  await deps.kv.put(`token:${accountId}`, encryptResult.value, {
    expirationTtl: KV_TOKEN_TTL,
  });

  return ok(undefined);
}

export { generateAppSecretProof } from "./crypto.js";
