import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  CreateIncomingWebhookInputSchema,
  UpdateIncomingWebhookInputSchema,
  IncomingWebhookPayloadSchema,
} from "@gramstep/shared";
import { createIncomingWebhookService } from "../../services/incoming-webhook.js";

export const incomingWebhookRoutes = new Hono<{ Bindings: Env }>();

// --- CRUD (authenticated) ---

incomingWebhookRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const svc = createIncomingWebhookService({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await svc.list(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

incomingWebhookRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = CreateIncomingWebhookInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const svc = createIncomingWebhookService({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await svc.create(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 201);
});

incomingWebhookRoutes.get("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const id = c.req.param("id");
  const svc = createIncomingWebhookService({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await svc.get(id, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

incomingWebhookRoutes.put("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateIncomingWebhookInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const svc = createIncomingWebhookService({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await svc.update(id, accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

incomingWebhookRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const id = c.req.param("id");
  const svc = createIncomingWebhookService({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await svc.delete(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});

// --- Public incoming webhook receive endpoint (HMAC signature auth) ---

export const incomingWebhookReceiveRoutes = new Hono<{ Bindings: Env }>();

incomingWebhookReceiveRoutes.post("/:id", async (c) => {
  const webhookId = c.req.param("id");
  const svc = createIncomingWebhookService({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });

  // Verify HMAC signature
  const signature = c.req.header("X-Signature-256");
  const timestamp = c.req.header("X-Timestamp");
  const nonce = c.req.header("X-Nonce");

  if (!signature || !timestamp || !nonce) {
    return c.json({ error: "Missing signature headers" }, 401);
  }

  // Look up webhook to get secret
  const rawBody = await c.req.text();

  const whRow = await c.env.DB
    .prepare(`SELECT secret FROM incoming_webhooks WHERE id = ? AND is_active = 1`)
    .bind(webhookId)
    .first<{ secret: string }>();

  if (!whRow) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  const valid = await svc.verifySignature(whRow.secret, timestamp, nonce, rawBody, signature);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse payload
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = IncomingWebhookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const result = await svc.processEvent(
    webhookId,
    parsed.data.ig_scoped_id,
    (parsed.data.data ?? {}) as Record<string, unknown>,
  );
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});
