import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

import type { Env } from "./env.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { apiRateLimit } from "./middleware/api-rate-limit.js";
import { requireAuth, requireRole, requirePermission } from "./middleware/auth.js";
import type { AuthOperator } from "./middleware/auth.js";
import { healthRoute } from "./routes/health.js";
import { webhook } from "./routes/webhook.js";
import { authRoutes } from "./routes/api/auth.js";
import { adminAuthRoutes } from "./routes/api/admin-auth.js";
import { scenarioRoutes } from "./routes/api/scenarios.js";
import { triggerRoutes } from "./routes/api/triggers.js";
import { automationRoutes } from "./routes/api/automations.js";
import { userRoutes } from "./routes/api/users.js";
import { chatRoutes } from "./routes/api/chats.js";
import { analyticsRoutes } from "./routes/api/analytics.js";
import { auditLogRoutes } from "./routes/api/audit-logs.js";
import { dataDeletionRoutes } from "./routes/api/data-deletion.js";
import { gdprRoutes } from "./routes/api/gdpr.js";
import { appReviewRoutes } from "./routes/api/app-review.js";
import { templateRoutes } from "./routes/api/templates.js";
import { broadcastRoutes } from "./routes/api/broadcasts.js";
import { notificationRoutes } from "./routes/api/notifications.js";
import { accountRoutes } from "./routes/api/accounts.js";
import { archiveRoutes } from "./routes/api/archive.js";
import { outgoingWebhookRoutes } from "./routes/api/outgoing-webhooks.js";
import { incomingWebhookRoutes, incomingWebhookReceiveRoutes } from "./routes/api/incoming-webhooks.js";
import { campaignRoutes } from "./routes/api/campaigns.js";
import { conversionRoutes } from "./routes/api/conversions.js";
import { apiKeyRoutes } from "./routes/api/api-keys.js";
import { trackedLinkRoutes } from "./routes/api/tracked-links.js";
import { entryRouteRoutes } from "./routes/api/entry-routes.js";
import { iceBreakerRoutes } from "./routes/api/ice-breakers.js";
import { persistentMenuRoutes } from "./routes/api/persistent-menu.js";
import { testModeRoutes } from "./routes/api/test-mode.js";
import { redirectRoute } from "./routes/redirect.js";
import { privacyPolicyRoute } from "./routes/privacy-policy.js";
import { mediaUploadRoutes } from "./routes/api/media-upload.js";
import { settingsRoutes } from "./routes/api/settings.js";
import { appConfigRoutes } from "./routes/api/app-config.js";
import { manualTokenRoutes } from "./routes/api/manual-token.js";
import { surveyRoutes } from "./routes/api/surveys.js";
import { docsRoute } from "./routes/docs.js";
import type { SendQueueMessage } from "@gramstep/shared";
import { createDeliveryEngine } from "./services/delivery-engine.js";
import { createRateLimiter } from "./services/rate-limiter.js";
import { createWindowManager } from "./services/window-manager.js";
import { createRealInstagramClient } from "@gramstep/ig-sdk";
import { getDecryptedToken, type AuthServiceDeps } from "./services/auth-service.js";
import { generateAppSecretProof } from "./services/crypto.js";
import { handleHealthAndReengagement } from "./cron/health-and-reengagement.js";
import { handleTokenRefresh } from "./cron/token-refresh.js";
import { handleAuditLogPurge } from "./cron/audit-log-purge.js";
import { handleWorkflowResume } from "./cron/workflow-resume.js";
import { handleDataDeletion } from "./cron/data-deletion.js";

export { DripWorkflow } from "./workflows/drip-workflow.js";

const app = new Hono<{ Bindings: Env }>();

// グローバルミドルウェア: セキュリティヘッダー + CORS
app.use("/*", securityHeaders());

// API レート制限 (APIキーごと / IPアドレスごと)
app.use("/api/*", apiRateLimit({ maxRequests: 100, windowSeconds: 60 }));

app.route("/", healthRoute);
app.route("/", webhook);
app.route("/api/auth", authRoutes);
app.route("/api/auth", manualTokenRoutes);
app.route("/api/admin/auth", adminAuthRoutes);

// 認証必須ルート: requireAuth で JWT 検証 + accountId 注入
app.use("/api/scenarios/*", requireAuth());
app.use("/api/triggers/*", requireAuth());
app.use("/api/automations/*", requireAuth());
app.use("/api/users/*", requireAuth());
app.use("/api/chats/*", requireAuth());
app.use("/api/analytics/*", requireAuth());
app.use("/api/settings/*", requireAuth());
app.use("/api/app-config", requireAuth());
app.use("/api/gdpr/*", requireAuth());
app.use("/api/templates/*", requireAuth());
app.use("/api/surveys/*", requireAuth());
app.use("/api/app-review/*", requireAuth());
app.use("/api/campaigns/*", requireAuth());
app.use("/api/campaigns/:id/*", requireAuth());
app.use("/api/broadcasts/*", requireAuth());
app.use("/api/notifications/*", requireAuth());
app.use("/api/outgoing-webhooks/*", requireAuth());
app.use("/api/incoming-webhooks/*", requireAuth());
app.use("/api/conversions/*", requireAuth());
app.use("/api/api-keys/*", requireAuth());
app.use("/api/tracked-links/*", requireAuth());
app.use("/api/entry-routes/*", requireAuth());
app.use("/api/ice-breakers/*", requireAuth());
app.use("/api/ice-breakers", requireAuth());
app.use("/api/accounts/*", requireAuth());
// RBAC: admin専用ルート
app.use("/api/api-keys/*", requireRole(["admin"]));
app.use("/api/accounts/*", requireRole(["admin"]));
app.use("/api/audit-logs/*", requirePermission("view_audit_logs"));
app.use("/api/app-review/*", requireRole(["admin"]));

// RBAC: viewerはGETのみ許可、POST/PUT/PATCH/DELETEはadmin/operatorのみ
const VIEWER_READABLE_PATHS = [
  "/api/scenarios/*", "/api/triggers/*", "/api/users/*", "/api/chats/*",
  "/api/automations/*",
  "/api/templates/*", "/api/surveys/*", "/api/conversions/*", "/api/tracked-links/*",
  "/api/analytics/*", "/api/gdpr/*",
];
for (const path of VIEWER_READABLE_PATHS) {
  app.use(path, async (c, next) => {
    const op = c.get("operator" as never) as AuthOperator | undefined;
    if (!op) return c.json({ error: "Authentication required" }, 401);
    if (op.role === "viewer" && c.req.method !== "GET") {
      return c.json({ error: "Forbidden: viewer role is read-only" }, 403);
    }
    await next();
  });
}
// admin/operator専用ルート（viewerアクセス不可）
app.use("/api/campaigns/*", requireRole(["admin", "operator"]));
app.use("/api/campaigns/:id/*", requireRole(["admin", "operator"]));
app.use("/api/broadcasts/*", requireRole(["admin", "operator"]));
app.use("/api/notifications/*", requireRole(["admin", "operator"]));
app.use("/api/outgoing-webhooks/*", requireRole(["admin", "operator"]));
app.use("/api/incoming-webhooks/*", requireRole(["admin", "operator"]));
app.use("/api/entry-routes/*", requireRole(["admin", "operator"]));
app.use("/api/ice-breakers/*", requireRole(["admin", "operator"]));
app.use("/api/persistent-menu/*", requireRole(["admin", "operator"]));
app.use("/api/test-mode/*", requireRole(["admin", "operator"]));
// accountId を operator.accountId から注入（フォールバック: x-account-id ヘッダー）
function injectAccountId(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const op = c.get("operator" as never) as AuthOperator | undefined;
    const accountId = op?.accountId || c.req.header("x-account-id") || "";
    c.set("accountId" as never, accountId as never);
    await next();
  };
}
app.use("/api/scenarios/*", injectAccountId());
app.use("/api/triggers/*", injectAccountId());
app.use("/api/automations/*", injectAccountId());
app.use("/api/users/*", injectAccountId());
app.use("/api/chats/*", injectAccountId());
app.use("/api/analytics/*", injectAccountId());
app.use("/api/gdpr/*", injectAccountId());
app.use("/api/templates/*", injectAccountId());
app.use("/api/surveys/*", injectAccountId());
app.use("/api/app-review/*", injectAccountId());
app.use("/api/campaigns/*", injectAccountId());
app.use("/api/campaigns/:id/*", injectAccountId());
app.use("/api/broadcasts/*", injectAccountId());
app.use("/api/notifications/*", injectAccountId());
app.use("/api/outgoing-webhooks/*", injectAccountId());
app.use("/api/incoming-webhooks/*", injectAccountId());
app.use("/api/conversions/*", injectAccountId());
app.use("/api/api-keys/*", injectAccountId());
app.use("/api/tracked-links/*", injectAccountId());
app.use("/api/entry-routes/*", injectAccountId());
app.use("/api/ice-breakers/*", injectAccountId());
app.use("/api/ice-breakers", injectAccountId());
app.use("/api/test/*", requireAuth());
app.use("/api/test/*", injectAccountId());

// Media upload/serve (auth required for upload, public for serve)
app.use("/api/media/upload", requireAuth());
app.use("/api/media/upload", injectAccountId());
app.route("/api/media", mediaUploadRoutes);

// Public routes (no auth required)
app.route("/", privacyPolicyRoute);
app.route("/", redirectRoute);

app.route("/api/settings", settingsRoutes);
app.route("/api/app-config", appConfigRoutes);
app.route("/api/templates", templateRoutes);
app.route("/api/surveys", surveyRoutes);
app.route("/api/scenarios", scenarioRoutes);
app.route("/api/triggers", triggerRoutes);
app.route("/api/automations", automationRoutes);
app.route("/api/users", userRoutes);
app.route("/api/chats", chatRoutes);
app.route("/api/analytics", analyticsRoutes);
app.route("/api/audit-logs", auditLogRoutes);
app.route("/api/data-deletion", dataDeletionRoutes);
app.route("/api/gdpr", gdprRoutes);
app.route("/api/app-review", appReviewRoutes);
app.route("/api/campaigns", campaignRoutes);
app.route("/api/broadcasts", broadcastRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/accounts", accountRoutes);
app.route("/api/archive", archiveRoutes);
app.route("/api/outgoing-webhooks", outgoingWebhookRoutes);
app.route("/api/incoming-webhooks", incomingWebhookRoutes);
app.route("/api/incoming-webhook", incomingWebhookReceiveRoutes);
app.route("/api/conversions", conversionRoutes);
app.route("/api/api-keys", apiKeyRoutes);
app.route("/api/tracked-links", trackedLinkRoutes);
app.route("/api/entry-routes", entryRouteRoutes);
app.route("/api/ice-breakers", iceBreakerRoutes);
app.route("/api/persistent-menu", persistentMenuRoutes);
app.route("/api/test", testModeRoutes);
app.route("/", docsRoute);

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<SendQueueMessage>, env: Env): Promise<void> {
    // メッセージからaccountIdを取得してトークンを復号
    const firstMsg = batch.messages[0]?.body;
    const accountId = firstMsg?.accountId ?? "";

    let appSecretProof = "";
    let igClient;
    try {
      const tokenResult = await getDecryptedToken(accountId, {
        db: env.DB, kv: env.KV, encryptionKey: env.ENCRYPTION_KEY,
      } as Pick<AuthServiceDeps, "db" | "kv" | "encryptionKey">);
      if (!tokenResult.ok) {
        // トークン復号失敗: 全メッセージをDLQへ送って終了
        await Promise.all(batch.messages.map((m) => env.DLQ.send(m.body)));
        batch.ackAll();
        return;
      }
      appSecretProof = await generateAppSecretProof(tokenResult.value, env.META_APP_SECRET);
      igClient = createRealInstagramClient({
        accessToken: tokenResult.value,
        apiVersion: env.META_API_VERSION,
      });
    } catch {
      // トークン取得失敗: 全メッセージをDLQへ送って終了
      await Promise.all(batch.messages.map((m) => env.DLQ.send(m.body)));
      batch.ackAll();
      return;
    }

    const rateLimiter = createRateLimiter({});
    const windowManager = createWindowManager({ db: env.DB, kv: env.KV });
    const engine = createDeliveryEngine({
      igClient,
      rateLimiter,
      windowManager,
      db: env.DB,
      kv: env.KV,
      sendQueue: env.SEND_QUEUE,
      dlq: env.DLQ,
      appSecretProof,
    });
    const messages = batch.messages.map((m) => m.body);
    await engine.processBatch(messages);
    batch.ackAll();
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    switch (event.cron) {
      case "*/5 * * * *":
        ctx.waitUntil(handleHealthAndReengagement(env));
        break;
      case "0 3 * * *":
        ctx.waitUntil(handleTokenRefresh(env));
        break;
      case "0 4 * * *":
        ctx.waitUntil(handleAuditLogPurge(env));
        break;
      case "*/15 * * * *":
        ctx.waitUntil(handleWorkflowResume(env));
        break;
      case "0 5 * * *":
        ctx.waitUntil(handleDataDeletion(env));
        break;
    }
  },
};
