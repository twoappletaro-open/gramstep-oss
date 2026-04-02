import { Hono } from "hono";
import type { Env } from "../../env.js";
import { createSurveyService } from "../../services/survey-service.js";
import {
  CreateSurveyInputSchema,
  UpdateSurveyInputSchema,
} from "@gramstep/shared";

const surveyRoutes = new Hono<{ Bindings: Env }>();

type SurveyErrorStatus = 400 | 404 | 500;

function errorStatus(code: string): SurveyErrorStatus {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "VALIDATION_ERROR":
      return 400;
    default:
      return 500;
  }
}

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

function getService(env: Env) {
  return createSurveyService({
    db: env.DB,
    sendQueue: env.SEND_QUEUE,
  });
}

surveyRoutes.get("/", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const includeArchived = c.req.query("includeArchived") === "true";
  const result = await getService(c.env).listSurveys(accountId, includeArchived);
  if (!result.ok) return c.json({ error: result.error.message }, 500);
  return c.json(result.value);
});

surveyRoutes.get("/field-options", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const result = await getService(c.env).listFieldOptions(accountId);
  if (!result.ok) return c.json({ error: result.error.message }, 500);
  return c.json(result.value);
});

surveyRoutes.post("/", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const body = await c.req.json();
  const parsed = CreateSurveyInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

  const result = await getService(c.env).createSurvey(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

surveyRoutes.post("/archive", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const body = await c.req.json() as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const result = await getService(c.env).archiveSurveys(accountId, ids);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

surveyRoutes.get("/:id/export", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const result = await getService(c.env).exportSurveyCsv(c.req.param("id"), accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="survey-${c.req.param("id")}.csv"`);
  return c.body(result.value);
});

surveyRoutes.post("/:id/start/:igUserId", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const surveyId = c.req.param("id");
  const igUserId = c.req.param("igUserId");
  const user = await c.env.DB
    .prepare("SELECT ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ?")
    .bind(igUserId, accountId)
    .first<{ ig_scoped_id: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  const result = await getService(c.env).startSurveyForUser(
    surveyId,
    accountId,
    igUserId,
    user.ig_scoped_id,
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

surveyRoutes.get("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const result = await getService(c.env).getSurvey(c.req.param("id"), accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

surveyRoutes.put("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const body = await c.req.json();
  const parsed = UpdateSurveyInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

  const result = await getService(c.env).updateSurvey(c.req.param("id"), accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

surveyRoutes.delete("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const result = await getService(c.env).deleteSurvey(c.req.param("id"), accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

export { surveyRoutes };
