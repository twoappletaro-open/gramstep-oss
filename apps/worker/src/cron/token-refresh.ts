import type { Env } from "../env.js";
import { executeQuery } from "@gramstep/db";
import type { Account } from "@gramstep/db";
import { refreshToken } from "../services/auth-service.js";
import type { AuthServiceDeps } from "../services/auth-service.js";

export type TokenRefreshResult = {
  refreshed: number;
  failed: number;
  errors: Array<{ accountId: string; message: string }>;
};

const THIRTY_DAYS_SECONDS = 30 * 86400;

export async function handleTokenRefresh(
  env: Env,
  fetcherOverride?: typeof fetch,
): Promise<TokenRefreshResult> {
  const now = Math.floor(Date.now() / 1000);
  const threshold = now + THIRTY_DAYS_SECONDS;

  // 有効期限30日以内のアカウントを検出
  const queryResult = await executeQuery<
    Pick<Account, "id" | "ig_user_id" | "token_expires_at">
  >(
    env.DB,
    "SELECT id, ig_user_id, token_expires_at FROM accounts WHERE token_expires_at <= ? AND token_expires_at > ?",
    threshold,
    now,
  );

  if (!queryResult.ok) {
    return {
      refreshed: 0,
      failed: 0,
      errors: [{ accountId: "query", message: queryResult.error.message }],
    };
  }

  const accounts = queryResult.value.results;
  const result: TokenRefreshResult = {
    refreshed: 0,
    failed: 0,
    errors: [],
  };

  const deps: AuthServiceDeps = {
    db: env.DB,
    kv: env.KV,
    metaAppId: env.META_APP_ID,
    metaAppSecret: env.META_APP_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
    metaApiVersion: env.META_API_VERSION,
    dashboardUrl: env.DASHBOARD_URL,
    fetcher: fetcherOverride,
  };

  for (const account of accounts) {
    const refreshResult = await refreshToken(account.id, deps);
    if (refreshResult.ok) {
      result.refreshed++;
    } else {
      result.failed++;
      result.errors.push({
        accountId: account.id,
        message: refreshResult.error.message,
      });
    }
  }

  return result;
}
