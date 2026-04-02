import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  createTemplateEngine,
  type TemplateEngineService,
} from "../../services/template-engine.js";
import {
  CreateTemplateInputSchema,
  UpdateTemplateInputSchema,
  TemplateTypeSchema,
} from "@gramstep/shared";

const templateRoutes = new Hono<{ Bindings: Env }>();

type TemplateErrorStatus = 400 | 404 | 409 | 500;

function errorStatus(code: string): TemplateErrorStatus {
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

function getEngine(env: Env): TemplateEngineService {
  return createTemplateEngine({ db: env.DB });
}

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

// GET /api/templates — 一覧
templateRoutes.get("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const type = c.req.query("type");
  const parsedType = type ? TemplateTypeSchema.safeParse(type) : null;
  const result = await engine.listTemplates(
    accountId,
    parsedType?.success ? parsedType.data : undefined,
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value);
});

// POST /api/templates — 作成
templateRoutes.post("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json();
  const parsed = CreateTemplateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const result = await engine.createTemplate(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

// GET /api/templates/:id — 詳細
templateRoutes.get("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await engine.getTemplate(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// PUT /api/templates/:id — 更新
templateRoutes.put("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json();
  const parsed = UpdateTemplateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const result = await engine.updateTemplate(id, accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// DELETE /api/templates/:id — 削除
templateRoutes.delete("/:id", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await engine.deleteTemplate(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/templates/:id/preview — プレビュー
templateRoutes.post("/:id/preview", async (c) => {
  const engine = getEngine(c.env);
  const id = c.req.param("id");
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json() as { sampleUserId?: string };
  const sampleUserId = body.sampleUserId;
  if (!sampleUserId) {
    return c.json({ error: "sampleUserId is required" }, 400);
  }

  // Fetch user
  const user = await c.env.DB
    .prepare(`SELECT * FROM ig_users WHERE id = ? AND account_id = ?`)
    .bind(sampleUserId, accountId)
    .first<import("@gramstep/db").IgUser>();
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Fetch user tags
  const tagResult = await c.env.DB
    .prepare(
      `SELECT t.name FROM tags t
       JOIN ig_user_tags iut ON iut.tag_id = t.id
       WHERE iut.ig_user_id = ?`,
    )
    .bind(sampleUserId)
    .all<{ name: string }>();
  const userTagNames = tagResult.results.map((t) => t.name);

  const result = await engine.renderTemplate(
    id,
    accountId,
    user,
    userTagNames,
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

export { templateRoutes };
