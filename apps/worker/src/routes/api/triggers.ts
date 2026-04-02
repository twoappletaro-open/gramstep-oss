import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  createTriggerEngine,
  type TriggerEngineService,
} from "../../services/trigger-engine.js";
import { CreateTriggerInputSchema, UpdateTriggerInputSchema } from "@gramstep/shared";

const triggerRoutes = new Hono<{ Bindings: Env }>();

type TriggerErrorStatus = 400 | 404 | 409 | 500;

function errorStatus(code: string): TriggerErrorStatus {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "VALIDATION_ERROR":
      return 400;
    default:
      return 500;
  }
}

function getEngine(env: Env): TriggerEngineService {
  return createTriggerEngine({ db: env.DB });
}

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

// GET /api/triggers — 一覧
triggerRoutes.get("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing x-account-id header" }, 400);
  }

  const type = c.req.query("type");
  const result = await engine.listTriggers(
    accountId,
    type as Parameters<TriggerEngineService["listTriggers"]>[1],
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value);
});

// POST /api/triggers — 作成
triggerRoutes.post("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing x-account-id header" }, 400);
  }

  const body = await c.req.json();
  const parsed = CreateTriggerInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const result = await engine.createTrigger(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

// GET /api/triggers/:id — 詳細
triggerRoutes.get("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");

  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }
  const result = await engine.getTrigger(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// PUT /api/triggers/:id — 更新
triggerRoutes.put("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");

  const body = await c.req.json();
  const parsed = UpdateTriggerInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }
  const result = await engine.updateTrigger(id, accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// DELETE /api/triggers/:id — 削除
triggerRoutes.delete("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");

  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }
  const result = await engine.deleteTrigger(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

export { triggerRoutes };
