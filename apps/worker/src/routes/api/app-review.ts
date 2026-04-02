import { Hono } from "hono";
import type { Env } from "../../env.js";
import { createAppReviewService } from "../../services/app-review-service.js";
import type { HumanAgentStatus } from "../../services/app-review-service.js";

const appReviewRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/app-review
 * Get App Review settings for the current account.
 */
appReviewRoutes.get("/", async (c) => {
  const accountId = (c.get("accountId" as never) as string | undefined);
  if (!accountId) return c.json({ error: "Authentication required" }, 400);

  const svc = createAppReviewService({ db: c.env.DB });
  const result = await svc.getSettings(accountId);

  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }

  return c.json(result.value, 200);
});

/**
 * PUT /api/app-review
 * Update App Review settings.
 */
appReviewRoutes.put("/", async (c) => {
  const accountId = (c.get("accountId" as never) as string | undefined);
  if (!accountId) return c.json({ error: "Authentication required" }, 400);

  const body = await c.req.json<{
    privacy_policy_url?: string;
    purpose_description?: string;
    verification_steps?: string;
  }>();

  const svc = createAppReviewService({ db: c.env.DB });
  const result = await svc.updateSettings(accountId, body);

  if (!result.ok) {
    const status = result.error.code === "VALIDATION_ERROR" ? 400 : 500;
    return c.json({ error: result.error.message }, status);
  }

  return c.json(result.value, 200);
});

/**
 * PUT /api/app-review/human-agent
 * Update HUMAN_AGENT permission status.
 */
appReviewRoutes.put("/human-agent", async (c) => {
  const accountId = (c.get("accountId" as never) as string | undefined);
  if (!accountId) return c.json({ error: "Authentication required" }, 400);

  const body = await c.req.json<{ status: HumanAgentStatus }>();
  const validStatuses: HumanAgentStatus[] = ["not_requested", "pending", "approved", "rejected"];
  if (!validStatuses.includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  const svc = createAppReviewService({ db: c.env.DB });
  const result = await svc.updateHumanAgentStatus(accountId, body.status);

  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }

  return c.json({ success: true }, 200);
});

export { appReviewRoutes };
