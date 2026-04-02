import { generateId, executeRun, executeFirst, executeQuery } from "@gramstep/db";
import type { AuditLog } from "@gramstep/db";
import type { Result, AppError, OperatorRole } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

// ────────── Types ──────────

export interface AuditLogView {
  id: string;
  operatorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  createdAt: number;
}

export interface CreateAuditLogInput {
  operatorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}

export interface AuditLogListQuery {
  limit: number;
  offset: number;
  resourceType?: string;
  operatorId?: string;
}

export interface AuditLogListResult {
  items: AuditLogView[];
  total: number;
}

export interface PurgeResult {
  deletedCount: number;
}

export interface AuditLogDeps {
  db: D1Database;
}

export interface AuditLogService {
  record(input: CreateAuditLogInput): Promise<Result<AuditLogView, AppError>>;
  list(query: AuditLogListQuery): Promise<Result<AuditLogListResult, AppError>>;
  deleteById(id: string, role: OperatorRole): Promise<Result<void, AppError>>;
  purgeExpired(): Promise<Result<PurgeResult, AppError>>;
}

// ────────── Helpers ──────────

const RETENTION_DAYS = 365;

function toView(row: AuditLog): AuditLogView {
  return {
    id: row.id,
    operatorId: row.operator_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details,
    createdAt: row.created_at,
  };
}

// ────────── Factory ──────────

export function createAuditLogService(deps: AuditLogDeps): AuditLogService {
  const { db } = deps;

  return {
    async record(input) {
      const id = generateId();
      const now = Math.floor(Date.now() / 1000);
      const detailsJson = input.details ? JSON.stringify(input.details) : null;

      const result = await executeRun(
        db,
        `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.operatorId,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        detailsJson,
        now,
      );

      if (!result.ok) {
        return err(createAppError("D1_ERROR", result.error.message));
      }

      return ok({
        id,
        operatorId: input.operatorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        details: detailsJson,
        createdAt: now,
      });
    },

    async list(query) {
      const conditions: string[] = [];
      const bindings: unknown[] = [];

      if (query.resourceType) {
        conditions.push("resource_type = ?");
        bindings.push(query.resourceType);
      }
      if (query.operatorId) {
        conditions.push("operator_id = ?");
        bindings.push(query.operatorId);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await executeFirst<{ total: number }>(
        db,
        `SELECT COUNT(*) as total FROM audit_logs ${where}`,
        ...bindings,
      );

      if (!countResult.ok) {
        return err(createAppError("D1_ERROR", countResult.error.message));
      }

      const total = countResult.value?.total ?? 0;

      const dataResult = await executeQuery<AuditLog>(
        db,
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ...bindings,
        query.limit,
        query.offset,
      );

      if (!dataResult.ok) {
        return err(createAppError("D1_ERROR", dataResult.error.message));
      }

      const items = (dataResult.value.results ?? []).map(toView);
      return ok({ items, total });
    },

    async deleteById(id, role) {
      if (role !== "admin") {
        return err(
          createAppError("FORBIDDEN", "Only admin can delete audit logs"),
        );
      }

      const existing = await executeFirst<AuditLog>(
        db,
        "SELECT * FROM audit_logs WHERE id = ?",
        id,
      );

      if (!existing.ok) {
        return err(createAppError("D1_ERROR", existing.error.message));
      }

      if (existing.value === null) {
        return err(createAppError("NOT_FOUND", `Audit log ${id} not found`));
      }

      const deleteResult = await executeRun(
        db,
        "DELETE FROM audit_logs WHERE id = ?",
        id,
      );

      if (!deleteResult.ok) {
        return err(createAppError("D1_ERROR", deleteResult.error.message));
      }

      return ok(undefined);
    },

    async purgeExpired() {
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - RETENTION_DAYS * 24 * 60 * 60;

      const result = await executeRun(
        db,
        "DELETE FROM audit_logs WHERE created_at < ?",
        cutoff,
      );

      if (!result.ok) {
        return err(createAppError("D1_ERROR", result.error.message));
      }

      const deletedCount = (result.value.meta as { changes?: number })?.changes ?? 0;
      return ok({ deletedCount });
    },
  };
}
