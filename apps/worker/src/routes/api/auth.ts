import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  initiateOAuth,
  saveOAuthState,
  handleCallback,
} from "../../services/auth-service.js";
import type { AuthServiceDeps } from "../../services/auth-service.js";
import {
  getResolvedAppContext,
  syncWebhookSubscriptionForSlot,
} from "../../services/app-failover.js";

const authRoutes = new Hono<{ Bindings: Env }>();

function buildRedirectUri(c: { req: { url: string } }): string {
  const url = new URL(c.req.url);
  return `${url.origin}/api/auth/callback`;
}

function buildDeps(env: Env, fetcher?: typeof fetch): AuthServiceDeps {
  return {
    db: env.DB,
    kv: env.KV,
    metaAppId: env.META_APP_ID,
    metaAppSecret: env.META_APP_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
    metaApiVersion: env.META_API_VERSION,
    dashboardUrl: env.DASHBOARD_URL,
    fetcher,
  };
}

// OAuth開始: stateを生成しInstagram認証画面へリダイレクト
authRoutes.get("/connect", async (c) => {
  const deps = buildDeps(c.env);
  const redirectUri = buildRedirectUri(c);
  const { authorizationUrl, state } = initiateOAuth(deps, redirectUri);

  await saveOAuthState(c.env.KV, state);

  return c.redirect(authorizationUrl, 302);
});

// OAuthコールバック: state検証→トークン交換→保存→ダッシュボードへリダイレクト
authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing code or state parameter" }, 400);
  }

  const deps = buildDeps(c.env);
  const redirectUri = buildRedirectUri(c);
  const result = await handleCallback(code, state, redirectUri, deps);

  if (!result.ok) {
    const status = result.error.code === "OAUTH_STATE_MISMATCH" ? 400 : 401;
    return c.json({ error: result.error.message }, status);
  }

  return c.redirect(c.env.DASHBOARD_URL, 302);
});

// APIテスト呼び出し（App Review用）
authRoutes.get("/api-test", async (c) => {
  const accountId = c.req.query("account_id");
  if (!accountId) return c.json({ error: "account_id required" }, 400);

  let appContext;
  try {
    appContext = await getResolvedAppContext(c.env, accountId);
  } catch {
    return c.json({ error: "Token not found" }, 404);
  }

  const token = appContext.accessToken;
  const proof = appContext.appSecretProof;
  const v = c.env.META_API_VERSION;

  const account = await c.env.DB.prepare("SELECT ig_user_id FROM accounts WHERE id = ?")
    .bind(accountId).first<{ ig_user_id: string }>();
  if (!account) return c.json({ error: "Account not found" }, 404);

  const results: Record<string, unknown> = {};

  // instagram_basic / instagram_business_basic: GET /me
  const meRes = await fetch(`https://graph.instagram.com/${v}/me?fields=user_id,username&access_token=${token}&appsecret_proof=${proof}`);
  results.me = await meRes.json();

  // instagram_basic: GET /{user-id} (プロフィール)
  const profileRes = await fetch(`https://graph.instagram.com/${v}/${account.ig_user_id}?fields=user_id,username,name,profile_picture_url&access_token=${token}&appsecret_proof=${proof}`);
  results.profile = await profileRes.json();

  // instagram_manage_comments: GET /{user-id}/media → comments
  const mediaRes = await fetch(`https://graph.instagram.com/${v}/${account.ig_user_id}/media?fields=id,caption,timestamp&limit=1&access_token=${token}&appsecret_proof=${proof}`);
  results.media = await mediaRes.json();

  // media があれば comments も取得
  const mediaData = results.media as { data?: Array<{ id: string }> };
  const firstMediaId = mediaData.data?.[0]?.id;
  if (firstMediaId) {
    const commentsRes = await fetch(`https://graph.instagram.com/${v}/${firstMediaId}/comments?fields=id,text,timestamp&limit=1&access_token=${token}&appsecret_proof=${proof}`);
    results.comments = await commentsRes.json();
  }

  return c.json({ ok: true, results });
});

// Webhook購読状態確認 & 再購読
authRoutes.get("/webhook-status", async (c) => {
  const accountId = c.req.query("account_id");
  if (!accountId) return c.json({ error: "account_id required" }, 400);

  let appContext;
  try {
    appContext = await getResolvedAppContext(c.env, accountId);
  } catch {
    return c.json({ error: "Token not found" }, 404);
  }

  // 現在の購読を取得
  const account = await c.env.DB.prepare("SELECT ig_user_id FROM accounts WHERE id = ?")
    .bind(accountId).first<{ ig_user_id: string }>();
  if (!account) return c.json({ error: "Account not found" }, 404);

  const res = await fetch(
    `https://graph.instagram.com/${c.env.META_API_VERSION}/${account.ig_user_id}/subscribed_apps?access_token=${appContext.accessToken}&appsecret_proof=${appContext.appSecretProof}`,
  );
  const data = await res.json();

  return c.json({ subscriptions: data, ig_user_id: account.ig_user_id, slot: appContext.slot });
});

// 手動Webhook再購読
authRoutes.post("/resubscribe", async (c) => {
  const body = await c.req.json() as { account_id?: string };
  const accountId = body.account_id;
  if (!accountId) return c.json({ error: "account_id required" }, 400);

  const account = await c.env.DB.prepare("SELECT ig_user_id FROM accounts WHERE id = ?")
    .bind(accountId).first<{ ig_user_id: string }>();
  if (!account) return c.json({ error: "Account not found" }, 404);

  let appContext;
  try {
    appContext = await getResolvedAppContext(c.env, accountId);
  } catch {
    return c.json({ error: "Token not found" }, 404);
  }

  const result = await syncWebhookSubscriptionForSlot(c.env, accountId, appContext.slot, "POST");
  if (!result.ok) {
    return c.json({ error: result.error ?? "Failed to resubscribe" }, 400);
  }

  return c.json({ result, ig_user_id: account.ig_user_id, slot: appContext.slot });
});

export { authRoutes };
