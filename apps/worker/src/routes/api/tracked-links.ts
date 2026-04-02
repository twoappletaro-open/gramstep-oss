import { Hono } from "hono";
import type { Env } from "../../env.js";
import { CreateTrackedLinkInputSchema } from "@gramstep/shared";
import { createLinkTracker } from "../../services/link-tracker.js";

export const trackedLinkRoutes = new Hono<{ Bindings: Env }>();

trackedLinkRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const rawLimit = Number(c.req.query("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const tracker = createLinkTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.listLinks(accountId, limit);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

trackedLinkRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = CreateTrackedLinkInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const tracker = createLinkTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.createLink(accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.message.includes("UNIQUE") ? 409 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 201);
});

trackedLinkRoutes.get("/:id/analytics", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const linkId = c.req.param("id");
  const tracker = createLinkTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.getLinkAnalytics(linkId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

trackedLinkRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const linkId = c.req.param("id");
  const tracker = createLinkTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.deleteLink(linkId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});
