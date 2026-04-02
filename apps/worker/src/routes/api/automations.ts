import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  CreateAutomationRuleInputSchema,
  UpdateAutomationRuleInputSchema,
} from "@gramstep/shared";
import { createAutomationRuleService } from "../../services/automation-rule-service.js";

export const automationRoutes = new Hono<{ Bindings: Env }>();

type AutomationErrorStatus = 400 | 404 | 409 | 500;

function errorStatus(code: string): AutomationErrorStatus {
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

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

function getService(env: Env) {
  return createAutomationRuleService({ db: env.DB });
}

automationRoutes.get("/", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const result = await getService(c.env).list(accountId);
  if (!result.ok) return c.json({ error: result.error.message }, errorStatus(result.error.code));
  return c.json(result.value);
});

automationRoutes.post("/", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const body = await c.req.json();
  const parsed = CreateAutomationRuleInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

  const result = await getService(c.env).create(accountId, parsed.data);
  if (!result.ok) return c.json({ error: result.error.message }, errorStatus(result.error.code));
  return c.json(result.value, 201);
});

automationRoutes.get("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const result = await getService(c.env).get(c.req.param("id"), accountId);
  if (!result.ok) return c.json({ error: result.error.message }, errorStatus(result.error.code));
  return c.json(result.value);
});

automationRoutes.put("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const body = await c.req.json();
  const parsed = UpdateAutomationRuleInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

  const result = await getService(c.env).update(c.req.param("id"), accountId, parsed.data);
  if (!result.ok) return c.json({ error: result.error.message }, errorStatus(result.error.code));
  return c.json(result.value);
});

automationRoutes.delete("/:id", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return c.json({ error: "Missing accountId" }, 400);

  const result = await getService(c.env).delete(c.req.param("id"), accountId);
  if (!result.ok) return c.json({ error: result.error.message }, errorStatus(result.error.code));
  return c.body(null, 204);
});
