import { Hono } from "hono";
import type { Env } from "../../env.js";

const appConfigRoutes = new Hono<{ Bindings: Env }>();

// GET /api/app-config — 現在のアプリ設定を取得（シークレットはマスク）
appConfigRoutes.get("/", async (c) => {
  return c.json({
    metaAppId: c.env.META_APP_ID,
    metaAppSecret: c.env.META_APP_SECRET ? `${c.env.META_APP_SECRET.slice(0, 4)}${"*".repeat(28)}` : "",
    metaApiVersion: c.env.META_API_VERSION,
    webhookVerifyToken: c.env.WEBHOOK_VERIFY_TOKEN ? `${c.env.WEBHOOK_VERIFY_TOKEN.slice(0, 4)}${"*".repeat(28)}` : "",
    dashboardUrl: c.env.DASHBOARD_URL ?? "",
    webhookUrl: new URL(c.req.url).origin + "/webhook",
    oauthCallbackUrl: new URL(c.req.url).origin + "/api/auth/callback",
    privacyPolicyUrl: new URL(c.req.url).origin + "/privacy-policy",
    dataDeletionUrl: new URL(c.req.url).origin + "/api/data-deletion",
  });
});

export { appConfigRoutes };
