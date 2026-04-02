import {
  AppFailoverConfigSchema,
  AccountAppFailoverSchema,
  type AppFailoverConfig,
  type AccountAppFailover,
  type AppSlot,
} from "@gramstep/shared";
import type { Env } from "../env.js";
import { decryptToken, encryptToken, generateAppSecretProof } from "./crypto.js";

const APP_FAILOVER_LEGACY_KV_KEY = "settings:app_failover";
const APP_FAILOVER_KV_PREFIX = "settings:app_failover:";
const WEBHOOK_FIELDS =
  "messages,messaging_postbacks,messaging_referral,messaging_seen,message_reactions,comments,live_comments";
const PRIMARY_TOKEN_CACHE_TTL = 3600;

interface AccountRow {
  id: string;
  ig_user_id: string;
  ig_username: string | null;
  access_token_encrypted: string | null;
  token_expires_at: number | null;
  settings: string | null;
}

export interface ResolvedAppContext {
  slot: AppSlot;
  igUserId: string;
  igUsername: string | null;
  accessToken: string;
  appSecret: string;
  appSecretProof: string;
}

export interface AppFailoverStatus {
  primaryApp: {
    metaAppId: string;
    metaApiVersion: string;
    webhookUrl: string;
    oauthCallbackUrl: string;
  };
  secondaryApp: {
    metaAppId: string;
    metaAppSecretConfigured: boolean;
    webhookVerifyTokenConfigured: boolean;
  } | null;
  account: {
    activeSlot: AppSlot;
    effectiveSlot: AppSlot;
    primaryTokenConfigured: boolean;
    secondaryTokenConfigured: boolean;
    primaryIgUserId: string | null;
    secondaryIgUserId: string | null;
    primaryIgUsername: string | null;
    secondaryIgUsername: string | null;
    lastSwitchedAt: number | null;
  };
}

function getAppFailoverKvKey(accountId: string): string {
  return `${APP_FAILOVER_KV_PREFIX}${accountId}`;
}

function parseSettingsObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseAccountAppFailover(raw: Record<string, unknown>): AccountAppFailover {
  const parsed = AccountAppFailoverSchema.safeParse(raw.app_failover);
  return parsed.success ? parsed.data : AccountAppFailoverSchema.parse({});
}

async function getAccountRow(
  db: D1Database,
  accountId: string,
): Promise<AccountRow | null> {
  return db
    .prepare(
      "SELECT id, ig_user_id, ig_username, access_token_encrypted, token_expires_at, settings FROM accounts WHERE id = ?",
    )
    .bind(accountId)
    .first<AccountRow>();
}

async function saveAccountAppFailover(
  db: D1Database,
  accountId: string,
  updater: (current: AccountAppFailover, settingsObj: Record<string, unknown>) => AccountAppFailover,
): Promise<AccountAppFailover | null> {
  const row = await getAccountRow(db, accountId);
  if (!row) return null;

  const settingsObj = parseSettingsObject(row.settings);
  const current = parseAccountAppFailover(settingsObj);
  settingsObj.app_failover = updater(current, settingsObj);

  await db
    .prepare("UPDATE accounts SET settings = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(settingsObj), Math.floor(Date.now() / 1000), accountId)
    .run();

  return settingsObj.app_failover as AccountAppFailover;
}

async function decryptSecondaryToken(
  failover: AccountAppFailover,
  encryptionKey: string,
): Promise<string | null> {
  if (!failover.secondaryTokenEncrypted) return null;
  const result = await decryptToken(failover.secondaryTokenEncrypted, encryptionKey);
  return result.ok ? result.value : null;
}

async function decryptPrimaryToken(
  row: AccountRow,
  env: Env,
): Promise<string | null> {
  if (!row.access_token_encrypted) return null;

  const cached = await env.KV.get(`token:${row.id}`);
  if (cached) {
    const cachedToken = await decryptToken(cached, env.ENCRYPTION_KEY);
    if (cachedToken.ok) return cachedToken.value;
  }

  const result = await decryptToken(row.access_token_encrypted, env.ENCRYPTION_KEY);
  if (!result.ok) return null;

  await env.KV.put(`token:${row.id}`, row.access_token_encrypted, {
    expirationTtl: PRIMARY_TOKEN_CACHE_TTL,
  });
  return result.value;
}

function getSecondaryConfig(config: AppFailoverConfig) {
  return config.secondaryApp;
}

function redactSecondaryConfig(config: AppFailoverConfig["secondaryApp"]): AppFailoverStatus["secondaryApp"] {
  if (!config) return null;
  return {
    metaAppId: config.metaAppId,
    metaAppSecretConfigured: Boolean(config.metaAppSecret),
    webhookVerifyTokenConfigured: Boolean(config.webhookVerifyToken),
  };
}

async function listStoredAppFailoverConfigs(env: Env): Promise<AppFailoverConfig[]> {
  const configs: AppFailoverConfig[] = [];

  try {
    const listed = await env.KV.list({ prefix: APP_FAILOVER_KV_PREFIX });
    for (const key of listed.keys ?? []) {
      const raw = await env.KV.get(key.name);
      if (!raw) continue;
      try {
        const parsed = AppFailoverConfigSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.secondaryApp) {
          configs.push(parsed.data);
        }
      } catch {
        // ignore malformed config
      }
    }
  } catch {
    // ignore KV list failures and fall back to legacy key only
  }

  try {
    const legacyRaw = await env.KV.get(APP_FAILOVER_LEGACY_KV_KEY);
    if (legacyRaw) {
      const parsed = AppFailoverConfigSchema.safeParse(JSON.parse(legacyRaw));
      if (parsed.success && parsed.data.secondaryApp) {
        configs.push(parsed.data);
      }
    }
  } catch {
    // ignore malformed legacy config
  }

  return configs;
}

export async function getAppFailoverConfig(
  kv: KVNamespace,
  accountId: string,
): Promise<AppFailoverConfig> {
  const raw = await kv.get(getAppFailoverKvKey(accountId));
  if (!raw) return AppFailoverConfigSchema.parse({});

  try {
    const parsed = AppFailoverConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : AppFailoverConfigSchema.parse({});
  } catch {
    return AppFailoverConfigSchema.parse({});
  }
}

export async function saveAppFailoverConfig(
  kv: KVNamespace,
  accountId: string,
  input: AppFailoverConfig,
): Promise<void> {
  const parsed = AppFailoverConfigSchema.parse(input);
  await kv.put(getAppFailoverKvKey(accountId), JSON.stringify(parsed));
}

export async function getWebhookVerifyTokens(env: Env): Promise<string[]> {
  const tokens = [env.WEBHOOK_VERIFY_TOKEN];

  const configs = await listStoredAppFailoverConfigs(env);
  for (const config of configs) {
    const secondary = getSecondaryConfig(config);
    if (secondary?.webhookVerifyToken) tokens.push(secondary.webhookVerifyToken);
  }

  return [...new Set(tokens.filter(Boolean))];
}

export async function getWebhookSecrets(env: Env): Promise<string[]> {
  const secrets = [env.META_APP_SECRET];

  const configs = await listStoredAppFailoverConfigs(env);
  for (const config of configs) {
    const secondary = getSecondaryConfig(config);
    if (secondary?.metaAppSecret) secrets.push(secondary.metaAppSecret);
  }

  return [...new Set(secrets.filter(Boolean))];
}

export async function getAccountFailoverStatus(
  env: Env,
  accountId: string,
  requestUrl: string,
): Promise<AppFailoverStatus | null> {
  const row = await getAccountRow(env.DB, accountId);
  if (!row) return null;

  const settingsObj = parseSettingsObject(row.settings);
  const accountFailover = parseAccountAppFailover(settingsObj);
  const config = await getAppFailoverConfig(env.KV, accountId);
  const effective = await getResolvedAppContext(env, accountId).catch(() => null);
  const origin = new URL(requestUrl).origin;

  return {
    primaryApp: {
      metaAppId: env.META_APP_ID,
      metaApiVersion: env.META_API_VERSION,
      webhookUrl: `${origin}/webhook`,
      oauthCallbackUrl: `${origin}/api/auth/callback`,
    },
    secondaryApp: redactSecondaryConfig(config.secondaryApp),
    account: {
      activeSlot: accountFailover.activeSlot,
      effectiveSlot: effective?.slot ?? "primary",
      primaryTokenConfigured: Boolean(row.access_token_encrypted),
      secondaryTokenConfigured: Boolean(accountFailover.secondaryTokenEncrypted),
      primaryIgUserId: row.ig_user_id ?? null,
      secondaryIgUserId: accountFailover.secondaryIgUserId,
      primaryIgUsername: row.ig_username ?? null,
      secondaryIgUsername: accountFailover.secondaryIgUsername,
      lastSwitchedAt: accountFailover.lastSwitchedAt,
    },
  };
}

export async function setAccountActiveSlot(
  db: D1Database,
  accountId: string,
  slot: AppSlot,
): Promise<AccountAppFailover | null> {
  return saveAccountAppFailover(db, accountId, (current) => ({
    ...current,
    activeSlot: slot,
    lastSwitchedAt: Math.floor(Date.now() / 1000),
  }));
}

export async function saveSecondaryTokenForAccount(
  env: Env,
  accountId: string,
  input: {
    accessToken: string;
    igUserId: string;
    igUsername: string | null;
    expiresAt: number | null;
  },
): Promise<boolean> {
  const encrypted = await encryptToken(input.accessToken, env.ENCRYPTION_KEY);
  if (!encrypted.ok) return false;

  const updated = await saveAccountAppFailover(env.DB, accountId, (current) => ({
    ...current,
    secondaryTokenEncrypted: encrypted.value,
    secondaryTokenExpiresAt: input.expiresAt,
    secondaryIgUserId: input.igUserId,
    secondaryIgUsername: input.igUsername,
  }));

  return updated !== null;
}

export async function clearSecondaryTokenForAccount(
  env: Env,
  accountId: string,
): Promise<boolean> {
  const updated = await saveAccountAppFailover(env.DB, accountId, (current) => ({
    ...current,
    secondaryTokenEncrypted: null,
    secondaryTokenExpiresAt: null,
    secondaryIgUserId: null,
    secondaryIgUsername: null,
  }));

  return updated !== null;
}

export async function getResolvedAppContext(
  env: Env,
  accountId: string,
  preferredSlot?: AppSlot,
): Promise<ResolvedAppContext> {
  const row = await getAccountRow(env.DB, accountId);
  if (!row) {
    throw new Error("Account not found");
  }

  const settingsObj = parseSettingsObject(row.settings);
  const accountFailover = parseAccountAppFailover(settingsObj);
  const config = await getAppFailoverConfig(env.KV, accountId);
  const desiredSlot = preferredSlot ?? accountFailover.activeSlot;

  if (desiredSlot === "secondary") {
    const secondary = getSecondaryConfig(config);
    const token = await decryptSecondaryToken(accountFailover, env.ENCRYPTION_KEY);
    if (secondary && token) {
      const proof = await generateAppSecretProof(token, secondary.metaAppSecret);
      return {
        slot: "secondary",
        igUserId: row.ig_user_id,
        igUsername: accountFailover.secondaryIgUsername ?? row.ig_username,
        accessToken: token,
        appSecret: secondary.metaAppSecret,
        appSecretProof: proof,
      };
    }
    if (preferredSlot === "secondary") {
      throw new Error("Secondary app is not ready");
    }
  }

  const primaryToken = await decryptPrimaryToken(row, env);
  if (!primaryToken) {
    throw new Error("Primary access token is not available");
  }

  return {
    slot: "primary",
    igUserId: row.ig_user_id,
    igUsername: row.ig_username,
    accessToken: primaryToken,
    appSecret: env.META_APP_SECRET,
    appSecretProof: await generateAppSecretProof(primaryToken, env.META_APP_SECRET),
  };
}

async function callWebhookSubscription(
  env: Env,
  context: ResolvedAppContext,
  method: "POST" | "DELETE",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://graph.instagram.com/${env.META_API_VERSION}/${context.igUserId}/subscribed_apps`,
      {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          subscribed_fields: WEBHOOK_FIELDS,
          access_token: context.accessToken,
          appsecret_proof: context.appSecretProof,
        }),
      },
    );

    if (!response.ok) {
      return { ok: false, error: `${method} subscribed_apps failed: ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Webhook subscription request failed",
    };
  }
}

export async function syncWebhookSubscriptionForSlot(
  env: Env,
  accountId: string,
  slot: AppSlot,
  method: "POST" | "DELETE" = "POST",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const context = await getResolvedAppContext(env, accountId, slot);
    return callWebhookSubscription(env, context, method);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to resolve app slot",
    };
  }
}

export async function switchAccountAppSlot(
  env: Env,
  accountId: string,
  targetSlot: AppSlot,
): Promise<{ activeSlot: AppSlot; unsubscribedPreviousSlot: boolean; warning?: string }> {
  const nextContext = await getResolvedAppContext(env, accountId, targetSlot);

  const row = await getAccountRow(env.DB, accountId);
  if (!row) throw new Error("Account not found");
  const currentSettings = parseAccountAppFailover(parseSettingsObject(row.settings));
  const previousSlot = currentSettings.activeSlot;

  const subscribeResult = await callWebhookSubscription(env, nextContext, "POST");
  if (!subscribeResult.ok) {
    throw new Error(subscribeResult.error ?? "Failed to subscribe webhook");
  }

  let unsubscribedPreviousSlot = true;
  let warning: string | undefined;
  if (previousSlot !== targetSlot) {
    try {
      const previousContext = await getResolvedAppContext(env, accountId, previousSlot);
      const unsubscribeResult = await callWebhookSubscription(env, previousContext, "DELETE");
      unsubscribedPreviousSlot = unsubscribeResult.ok;
      if (!unsubscribeResult.ok) {
        warning = unsubscribeResult.error ?? "Failed to unsubscribe previous slot";
      }
    } catch (error) {
      unsubscribedPreviousSlot = false;
      warning = error instanceof Error ? error.message : "Failed to unsubscribe previous slot";
    }
  }

  const updated = await setAccountActiveSlot(env.DB, accountId, targetSlot);
  if (!updated) throw new Error("Failed to save active slot");

  return {
    activeSlot: targetSlot,
    unsubscribedPreviousSlot,
    warning,
  };
}
