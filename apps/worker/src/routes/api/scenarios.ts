import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  createScenarioEngine,
  type ScenarioEngineService,
} from "../../services/scenario-engine.js";
import { createEnrollmentService } from "../../services/enrollment-service.js";
import { CreateScenarioInputSchema, UpdateScenarioInputSchema } from "@gramstep/shared";

const scenarioRoutes = new Hono<{ Bindings: Env }>();

type ScenarioErrorStatus = 400 | 404 | 409 | 500;

function errorStatus(code: string): ScenarioErrorStatus {
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

function getEngine(env: Env): ScenarioEngineService {
  return createScenarioEngine({ db: env.DB });
}

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

// GET /api/scenarios — 一覧
scenarioRoutes.get("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing x-account-id header" }, 400);
  }

  const result = await engine.listScenarios(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value);
});

// POST /api/scenarios — 作成
scenarioRoutes.post("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing x-account-id header" }, 400);
  }

  const body = await c.req.json();
  const parsed = CreateScenarioInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const result = await engine.createScenario(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

// GET /api/scenarios/:id — 詳細
scenarioRoutes.get("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");

  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }
  const result = await engine.getScenario(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// PUT /api/scenarios/:id — 更新
scenarioRoutes.put("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");

  const body = await c.req.json();
  const parsed = UpdateScenarioInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }
  const result = await engine.updateScenario(id, accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// DELETE /api/scenarios/:id — 削除
scenarioRoutes.delete("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");

  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }
  const result = await engine.deleteScenario(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/scenarios/:id/enroll/:igUserId — シナリオ登録
scenarioRoutes.post("/:id/enroll/:igUserId", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing x-account-id header" }, 400);
  }

  const scenarioId = c.req.param("id");
  const igUserId = c.req.param("igUserId");

  const enrollmentService = createEnrollmentService({
    db: c.env.DB,
    dripWorkflow: c.env.DRIP_WORKFLOW,
  });

  const result = await enrollmentService.enrollUser(scenarioId, igUserId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

export { scenarioRoutes };
