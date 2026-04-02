import { Hono } from "hono";
import type { Env } from "../../env.js";
import { createGdprService } from "../../services/gdpr-service.js";

const gdprRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/gdpr/consent
 * Record user consent for data processing.
 */
gdprRoutes.post("/consent", async (c) => {
  const accountId = (c.get("accountId" as never) as string | undefined);
  if (!accountId) {
    return c.json({ error: "Authentication required" }, 400);
  }

  const body = await c.req.json<{ ig_user_id: string; consent_type: string }>();
  if (!body.ig_user_id || !body.consent_type) {
    return c.json({ error: "Missing ig_user_id or consent_type" }, 400);
  }

  const svc = createGdprService({ db: c.env.DB });
  const result = await svc.recordConsent(accountId, body.ig_user_id, body.consent_type);

  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }

  return c.json({ success: true }, 200);
});

/**
 * GET /api/gdpr/consent/:igUserId
 * Get consent status for a user.
 */
gdprRoutes.get("/consent/:igUserId", async (c) => {
  const accountId = (c.get("accountId" as never) as string | undefined);
  if (!accountId) {
    return c.json({ error: "Authentication required" }, 400);
  }

  const igUserId = c.req.param("igUserId");
  const svc = createGdprService({ db: c.env.DB });
  const result = await svc.getConsentStatus(accountId, igUserId);

  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }

  return c.json(result.value, 200);
});

/**
 * GET /api/gdpr/export/:igUserId
 * Export all user data as JSON (data portability).
 */
gdprRoutes.get("/export/:igUserId", async (c) => {
  const accountId = (c.get("accountId" as never) as string | undefined);
  if (!accountId) {
    return c.json({ error: "Authentication required" }, 400);
  }

  const igUserId = c.req.param("igUserId");
  const svc = createGdprService({ db: c.env.DB });
  const result = await svc.exportUserData(accountId, igUserId);

  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }

  return c.json(result.value, 200);
});

export { gdprRoutes };
