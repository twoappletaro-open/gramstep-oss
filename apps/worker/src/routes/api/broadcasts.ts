import { Hono } from "hono";
import { z } from "zod";
import { SegmentFilterSchema } from "@gramstep/shared";
import type { Env } from "../../env.js";
import { createBroadcastAdminService } from "../../services/broadcast-admin.js";

export const broadcastRoutes = new Hono<{ Bindings: Env }>();

const BroadcastSaveModeSchema = z.enum(["draft", "publish"]);

const BroadcastWriteSchema = z.object({
  name: z.string().min(1).max(255),
  template_id: z.string().min(1),
  segment: SegmentFilterSchema.default({ logic: "and", conditions: [] }),
  scheduled_at: z.number().int().nullable().default(null),
  save_mode: BroadcastSaveModeSchema.default("publish"),
});

const BroadcastUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  template_id: z.string().min(1).optional(),
  segment: SegmentFilterSchema.optional(),
  scheduled_at: z.number().int().nullable().optional(),
  save_mode: BroadcastSaveModeSchema.default("publish"),
});

function getService(env: Env) {
  return createBroadcastAdminService({
    db: env.DB,
    sendQueue: env.SEND_QUEUE,
    now: () => Math.floor(Date.now() / 1000),
  });
}

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

function errorStatus(code: string): 400 | 404 | 409 | 500 {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "BROADCAST_LIMIT_EXCEEDED":
    case "HEALTH_DANGER":
      return 409;
    default:
      return 500;
  }
}

broadcastRoutes.get("/", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await getService(c.env).list(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

broadcastRoutes.post("/preview", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    segment: SegmentFilterSchema.default({ logic: "and", conditions: [] }),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(20),
  }).safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const result = await getService(c.env).previewSegment(
    accountId,
    parsed.data.segment,
    parsed.data.page,
    parsed.data.limit,
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

broadcastRoutes.post("/", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = BroadcastWriteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const result = await getService(c.env).create(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

broadcastRoutes.get("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await getService(c.env).get(accountId, c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

broadcastRoutes.put("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = BroadcastUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const result = await getService(c.env).update(accountId, c.req.param("id"), parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

broadcastRoutes.delete("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await getService(c.env).delete(accountId, c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

broadcastRoutes.get("/:id/recipients", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const url = new URL(c.req.url);
  const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "20"), 1), 100);

  const result = await getService(c.env).previewRecipients(accountId, c.req.param("id"), page, limit);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});
