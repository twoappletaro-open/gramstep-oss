import { Hono } from "hono";
import type { Env } from "../../env.js";
import { CreateNotificationRuleInputSchema, UpdateNotificationRuleInputSchema } from "@gramstep/shared";
import { createNotificationEngine } from "../../services/notification-engine.js";

export const notificationRoutes = new Hono<{ Bindings: Env }>();

// --- Notification Rules CRUD ---

notificationRoutes.get("/rules", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const engine = createNotificationEngine({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await engine.listRules(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

notificationRoutes.post("/rules", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = CreateNotificationRuleInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const engine = createNotificationEngine({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await engine.createRule(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 201);
});

notificationRoutes.put("/rules/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const ruleId = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateNotificationRuleInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const engine = createNotificationEngine({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await engine.updateRule(ruleId, accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

notificationRoutes.delete("/rules/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const ruleId = c.req.param("id");
  const engine = createNotificationEngine({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await engine.deleteRule(ruleId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});

// --- Notifications list & read ---

notificationRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const page = Number(c.req.query("page") ?? "1");
  const perPage = Number(c.req.query("per_page") ?? "20");
  const engine = createNotificationEngine({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await engine.listNotifications(accountId, page, perPage);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

notificationRoutes.post("/:id/read", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const notifId = c.req.param("id");
  const engine = createNotificationEngine({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await engine.markAsRead(notifId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});
