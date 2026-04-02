import { Hono } from "hono";
import type { Env } from "../../env.js";
import { CreateOutgoingWebhookInputSchema, UpdateOutgoingWebhookInputSchema } from "@gramstep/shared";
import { createEventBus } from "../../services/event-bus.js";

export const outgoingWebhookRoutes = new Hono<{ Bindings: Env }>();

outgoingWebhookRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const bus = createEventBus({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await bus.listWebhooks(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

outgoingWebhookRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = CreateOutgoingWebhookInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const bus = createEventBus({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await bus.createWebhook(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 201);
});

outgoingWebhookRoutes.get("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const webhookId = c.req.param("id");
  const bus = createEventBus({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await bus.getWebhook(webhookId, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

outgoingWebhookRoutes.put("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const webhookId = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateOutgoingWebhookInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const bus = createEventBus({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await bus.updateWebhook(webhookId, accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

outgoingWebhookRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const webhookId = c.req.param("id");
  const bus = createEventBus({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await bus.deleteWebhook(webhookId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});

outgoingWebhookRoutes.get("/:id/logs", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const webhookId = c.req.param("id");
  const limit = Number(c.req.query("limit") ?? "50");
  const bus = createEventBus({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await bus.listLogs(webhookId, accountId, limit);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});
