import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  RegisterTestAccountInputSchema,
  DryRunInputSchema,
  SimulateTriggerInputSchema,
} from "@gramstep/shared";
import { createTestModeService } from "../../services/test-mode.js";

export const testModeRoutes = new Hono<{ Bindings: Env }>();

function getService(env: Env) {
  return createTestModeService({
    db: env.DB,
    now: () => Math.floor(Date.now() / 1000),
  });
}

// POST /api/test/accounts — テストアカウント登録
testModeRoutes.post("/accounts", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = RegisterTestAccountInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const svc = getService(c.env);
  const result = await svc.registerTestAccount(accountId, parsed.data.ig_scoped_id);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 201);
});

// GET /api/test/accounts — テストアカウント一覧
testModeRoutes.get("/accounts", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const svc = getService(c.env);
  const result = await svc.listTestAccounts(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

// DELETE /api/test/accounts/:id — テストアカウント削除
testModeRoutes.delete("/accounts/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const testAccountId = c.req.param("id");
  const svc = getService(c.env);
  const result = await svc.deleteTestAccount(testAccountId, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json({ ok: true }, 200);
});

// POST /api/test/dry-run/:scenarioId — シナリオドライラン
testModeRoutes.post("/dry-run/:scenarioId", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const scenarioId = c.req.param("scenarioId");
  const body = await c.req.json();
  const parsed = DryRunInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const svc = getService(c.env);
  const result = await svc.dryRunScenario(scenarioId, parsed.data.test_account_id, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

// POST /api/test/simulate-trigger/:triggerId — トリガーシミュレーション
testModeRoutes.post("/simulate-trigger/:triggerId", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const triggerId = c.req.param("triggerId");
  const body = await c.req.json();
  const parsed = SimulateTriggerInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const svc = getService(c.env);
  const result = await svc.simulateTrigger(triggerId, accountId, parsed.data.event_payload);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});
