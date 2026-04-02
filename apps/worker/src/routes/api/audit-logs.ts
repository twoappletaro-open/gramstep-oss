import { Hono } from "hono";
import type { Env } from "../../env.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import type { AuthOperator } from "../../middleware/auth.js";
import { createAuditLogService } from "../../services/audit-log-service.js";
import type { OperatorRole } from "@gramstep/shared";

const ERROR_STATUS_MAP = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  D1_ERROR: 500,
} as const;

type AuditErrorStatus = (typeof ERROR_STATUS_MAP)[keyof typeof ERROR_STATUS_MAP] | 500;

function errorStatus(code: string): AuditErrorStatus {
  return ERROR_STATUS_MAP[code as keyof typeof ERROR_STATUS_MAP] ?? 500;
}

export const auditLogRoutes = new Hono<{ Bindings: Env }>();

// 認証 + view_audit_logs 権限必須
auditLogRoutes.use("*", requireAuth(), requirePermission("view_audit_logs"));

// GET /api/audit-logs — 一覧（ページネーション付き）
auditLogRoutes.get("/", async (c) => {
  const svc = createAuditLogService({ db: c.env.DB });

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const resourceType = c.req.query("resource_type");
  const operatorId = c.req.query("operator_id");

  const result = await svc.list({
    limit,
    offset,
    resourceType: resourceType ?? undefined,
    operatorId: operatorId ?? undefined,
  });

  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }

  return c.json(result.value);
});

// DELETE /api/audit-logs/:id — admin のみ削除可
auditLogRoutes.delete("/:id", async (c) => {
  const svc = createAuditLogService({ db: c.env.DB });
  const operator = c.get("operator" as never) as AuthOperator;
  const id = c.req.param("id");

  const result = await svc.deleteById(id, operator.role as OperatorRole);

  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }

  return c.body(null, 204);
});
