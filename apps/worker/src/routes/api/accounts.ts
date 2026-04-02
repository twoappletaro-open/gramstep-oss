import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../env.js";
import { createAccountManager } from "../../services/account-manager.js";
import { createAccountConfigCopyService, type AccountConfigExport } from "../../services/account-config-copy.js";
import { generateId } from "@gramstep/db";
import { SyncPolicySchema } from "@gramstep/shared";

export const accountRoutes = new Hono<{ Bindings: Env }>();

const ERROR_STATUS_MAP = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  EXTERNAL_API_ERROR: 502,
} as const;

type AccountErrorStatus = (typeof ERROR_STATUS_MAP)[keyof typeof ERROR_STATUS_MAP] | 500;

function errorStatus(code: string): AccountErrorStatus {
  return ERROR_STATUS_MAP[code as keyof typeof ERROR_STATUS_MAP] ?? 500;
}

function buildManager(env: Env) {
  return createAccountManager({
    db: env.DB,
    kv: env.KV,
    now: () => Math.floor(Date.now() / 1000),
    metaAppSecret: env.META_APP_SECRET,
    metaApiVersion: env.META_API_VERSION,
    encryptionKey: env.ENCRYPTION_KEY,
  });
}

// GET /api/accounts - 全アカウント一覧
accountRoutes.get("/", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.listAccounts();
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value);
});

// GET /api/accounts/:id - アカウント詳細
accountRoutes.get("/:id", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.getAccount(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// PUT /api/accounts/:id - アカウント更新
const UpdateAccountInputSchema = z.object({
  timezone: z.string().min(1).optional(),
});

accountRoutes.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = UpdateAccountInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }
  const mgr = buildManager(c.env);
  const result = await mgr.updateAccount(c.req.param("id"), parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ success: true });
});

// DELETE /api/accounts/:id - アカウント削除
accountRoutes.delete("/:id", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.deleteAccount(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ success: true });
});

// POST /api/accounts/:id/webhook/subscribe - Webhook購読
accountRoutes.post("/:id/webhook/subscribe", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.subscribeWebhook(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ success: true });
});

// POST /api/accounts/:id/webhook/unsubscribe - Webhook購読解除
accountRoutes.post("/:id/webhook/unsubscribe", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.unsubscribeWebhook(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ success: true });
});

// GET /api/accounts/:id/sync-policy - 同期ポリシー取得
accountRoutes.get("/:id/sync-policy", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.getSyncPolicy(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ sync_policy: result.value });
});

// PUT /api/accounts/:id/sync-policy - 同期ポリシー更新
const UpdateSyncPolicyInputSchema = z.object({
  sync_policy: SyncPolicySchema,
});

accountRoutes.put("/:id/sync-policy", async (c) => {
  const body = await c.req.json();
  const parsed = UpdateSyncPolicyInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }
  const mgr = buildManager(c.env);
  const result = await mgr.updateSyncPolicy(
    c.req.param("id"),
    parsed.data.sync_policy,
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ success: true });
});

// GET /api/accounts/:id/access - アクセス権一覧
accountRoutes.get("/:id/access", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.listAccountOperators(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// POST /api/accounts/:id/access - アクセス権付与
const GrantAccessInputSchema = z.object({
  operator_id: z.string().min(1),
});

accountRoutes.post("/:id/access", async (c) => {
  const body = await c.req.json();
  const parsed = GrantAccessInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }
  const mgr = buildManager(c.env);
  const result = await mgr.grantAccess(parsed.data.operator_id, c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ success: true }, 201);
});

// DELETE /api/accounts/:id/access/:operatorId - アクセス権取り消し
accountRoutes.delete("/:id/access/:operatorId", async (c) => {
  const mgr = buildManager(c.env);
  const result = await mgr.revokeAccess(
    c.req.param("operatorId"),
    c.req.param("id"),
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ success: true });
});

// GET /api/accounts/:id/config/export - 設定エクスポート
accountRoutes.get("/:id/config/export", async (c) => {
  const svc = createAccountConfigCopyService({
    db: c.env.DB,
    generateId,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await svc.exportConfig(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// POST /api/accounts/:id/config/import - 設定インポート
const AccountConfigImportSchema = z.object({
  version: z.number().int(),
  exportedAt: z.number().int(),
  sourceAccountId: z.string(),
  scenarios: z.array(z.object({
    name: z.string().min(1),
    trigger_type: z.string(),
    trigger_config: z.string(),
    is_active: z.boolean(),
    bot_disclosure_enabled: z.boolean(),
    steps: z.array(z.object({
      step_order: z.number().int(),
      delay_seconds: z.number().int(),
      absolute_datetime: z.number().int().nullable(),
      message_type: z.string(),
      message_payload: z.string(),
      condition_config: z.string().nullable(),
    })),
  })),
  triggers: z.array(z.object({
    name: z.string().min(1),
    trigger_type: z.string(),
    match_type: z.string(),
    keywords: z.array(z.string()),
    actions: z.array(z.record(z.unknown())),
    schedule_config: z.string().nullable(),
    fire_mode: z.string(),
    is_active: z.boolean(),
  })),
  templates: z.array(z.object({
    name: z.string().min(1),
    type: z.string(),
    body: z.string(),
    variables: z.array(z.record(z.unknown())),
    is_active: z.boolean(),
  })),
});

accountRoutes.post("/:id/config/import", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = AccountConfigImportSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid import data", details: parsed.error.issues }, 400);
  }

  const svc = createAccountConfigCopyService({
    db: c.env.DB,
    generateId,
    now: () => Math.floor(Date.now() / 1000),
  });
  const result = await svc.importConfig(
    c.req.param("id"),
    parsed.data as AccountConfigExport,
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});
