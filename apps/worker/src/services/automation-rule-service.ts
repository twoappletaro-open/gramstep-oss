import { generateId } from "@gramstep/db";
import type {
  Result,
  AppError,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
  AutomationConditionGroup,
  TriggerAction,
} from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

interface AutomationRuleRow {
  id: string;
  account_id: string;
  name: string;
  condition_group: string;
  actions: string;
  is_active: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface AutomationRuleView {
  id: string;
  account_id: string;
  name: string;
  condition_group: AutomationConditionGroup;
  actions: TriggerAction[];
  is_active: boolean;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface AutomationRuleService {
  list(accountId: string): Promise<Result<AutomationRuleView[], AppError>>;
  get(id: string, accountId: string): Promise<Result<AutomationRuleView, AppError>>;
  create(accountId: string, input: CreateAutomationRuleInput): Promise<Result<AutomationRuleView, AppError>>;
  update(id: string, accountId: string, input: UpdateAutomationRuleInput): Promise<Result<AutomationRuleView, AppError>>;
  delete(id: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface AutomationRuleServiceDeps {
  db: D1Database;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: AutomationRuleRow): AutomationRuleView {
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    condition_group: parseJson(row.condition_group, { logic: "and", conditions: [] }),
    actions: parseJson(row.actions, []),
    is_active: row.is_active === 1,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getRow(db: D1Database, id: string, accountId: string): Promise<AutomationRuleRow | null> {
  return db
    .prepare("SELECT * FROM automation_rules WHERE id = ? AND account_id = ?")
    .bind(id, accountId)
    .first<AutomationRuleRow>();
}

export function createAutomationRuleService(deps: AutomationRuleServiceDeps): AutomationRuleService {
  const { db } = deps;

  return {
    async list(accountId) {
      const result = await db
        .prepare("SELECT * FROM automation_rules WHERE account_id = ? ORDER BY created_at DESC")
        .bind(accountId)
        .all<AutomationRuleRow>();
      return ok((result.results ?? []).map(mapRow));
    },

    async get(id, accountId) {
      const row = await getRow(db, id, accountId);
      if (!row) {
        return err(createAppError("NOT_FOUND", "Automation rule not found"));
      }
      return ok(mapRow(row));
    },

    async create(accountId, input) {
      const id = generateId();
      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `INSERT INTO automation_rules
            (id, account_id, name, condition_group, actions, is_active, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          id,
          accountId,
          input.name,
          JSON.stringify(input.condition_group),
          JSON.stringify(input.actions),
          input.is_active ? 1 : 0,
          now,
          now,
        )
        .run();

      const created = await getRow(db, id, accountId);
      if (!created) {
        return err(createAppError("D1_ERROR", "Failed to load created automation rule"));
      }
      return ok(mapRow(created));
    },

    async update(id, accountId, input) {
      const existing = await getRow(db, id, accountId);
      if (!existing) {
        return err(createAppError("NOT_FOUND", "Automation rule not found"));
      }
      if (existing.version !== input.version) {
        return err(createAppError("CONFLICT", "Automation rule version conflict"));
      }

      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `UPDATE automation_rules
           SET name = ?, condition_group = ?, actions = ?, is_active = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND account_id = ? AND version = ?`,
        )
        .bind(
          input.name ?? existing.name,
          JSON.stringify(input.condition_group ?? parseJson(existing.condition_group, { logic: "and", conditions: [] })),
          JSON.stringify(input.actions ?? parseJson(existing.actions, [])),
          input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
          now,
          id,
          accountId,
          input.version,
        )
        .run();

      const updated = await getRow(db, id, accountId);
      if (!updated) {
        return err(createAppError("D1_ERROR", "Failed to load updated automation rule"));
      }
      return ok(mapRow(updated));
    },

    async delete(id, accountId) {
      const existing = await getRow(db, id, accountId);
      if (!existing) {
        return err(createAppError("NOT_FOUND", "Automation rule not found"));
      }
      await db
        .prepare("DELETE FROM automation_rules WHERE id = ? AND account_id = ?")
        .bind(id, accountId)
        .run();
      return ok(undefined);
    },
  };
}
