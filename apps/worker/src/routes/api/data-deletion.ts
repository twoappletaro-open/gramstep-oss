import { Hono } from "hono";
import type { Env } from "../../env.js";
import { createDataDeletionService } from "../../services/data-deletion-service.js";

const dataDeletionRoutes = new Hono<{ Bindings: Env }>();

/**
 * Meta Data Deletion Request Callback
 * POST /api/data-deletion
 * Receives signed deletion requests from Meta and processes them.
 */
dataDeletionRoutes.post("/", async (c) => {
  const body = await c.req.text();
  const signatureHeader = c.req.header("X-Hub-Signature-256") ?? null;

  const svc = createDataDeletionService({
    db: c.env.DB,
    kv: c.env.KV,
    r2: c.env.R2,
    appSecret: c.env.META_APP_SECRET,
    baseUrl: new URL(c.req.url).origin,
  });

  const result = await svc.verifyAndProcessCallback(body, signatureHeader);

  if (!result.ok) {
    const status = result.error.code === "UNAUTHORIZED" ? 403 : 400;
    return c.json({ error: result.error.message }, status);
  }

  return c.json(result.value, 200);
});

export { dataDeletionRoutes };
