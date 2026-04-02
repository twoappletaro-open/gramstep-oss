import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  CreateEntryRouteInputSchema,
  UpdateEntryRouteInputSchema,
} from "@gramstep/shared";
import { createEntryRouteTracker } from "../../services/entry-route-tracker.js";

export const entryRouteRoutes = new Hono<{ Bindings: Env }>();

entryRouteRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const tracker = createEntryRouteTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.listRoutes(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

entryRouteRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = CreateEntryRouteInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const tracker = createEntryRouteTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.createRoute(accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.message.includes("UNIQUE") ? 409 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 201);
});

entryRouteRoutes.get("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const routeId = c.req.param("id");
  const tracker = createEntryRouteTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.getById(routeId, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

entryRouteRoutes.put("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const routeId = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = UpdateEntryRouteInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const tracker = createEntryRouteTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.updateRoute(routeId, accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

entryRouteRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const routeId = c.req.param("id");
  const tracker = createEntryRouteTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.deleteRoute(routeId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});

entryRouteRoutes.get("/:id/analytics", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const routeId = c.req.param("id");
  const tracker = createEntryRouteTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.getRouteAnalytics(routeId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});
