import { generateId } from "@gramstep/db";
import type { Scenario, ScenarioStep } from "@gramstep/db";
import type { Result, AppError, CreateScenarioInput, UpdateScenarioInput } from "@gramstep/shared";
import { ok, err, createAppError, CreateScenarioInputSchema } from "@gramstep/shared";

export interface ScenarioView {
  id: string;
  accountId: string;
  name: string;
  triggerType: string;
  triggerConfig: string;
  isActive: boolean;
  botDisclosureEnabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  steps: StepView[];
}

export interface StepView {
  id: string;
  scenarioId: string;
  stepOrder: number;
  delaySeconds: number;
  absoluteDatetime: number | null;
  messageType: string;
  messagePayload: string;
  conditionConfig: string | null;
  createdAt: number;
}

export interface ScenarioEngineService {
  createScenario(accountId: string, input: CreateScenarioInput): Promise<Result<ScenarioView, AppError>>;
  getScenario(scenarioId: string, accountId: string): Promise<Result<ScenarioView, AppError>>;
  listScenarios(accountId: string): Promise<Result<ScenarioView[], AppError>>;
  updateScenario(scenarioId: string, accountId: string, input: UpdateScenarioInput): Promise<Result<ScenarioView, AppError>>;
  deleteScenario(scenarioId: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface ScenarioEngineDeps {
  db: D1Database;
}

function toScenarioView(row: Scenario, steps: ScenarioStep[]): ScenarioView {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    triggerType: row.trigger_type,
    triggerConfig: row.trigger_config,
    isActive: row.is_active === 1,
    botDisclosureEnabled: row.bot_disclosure_enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: steps.map(toStepView),
  };
}

function toStepView(row: ScenarioStep): StepView {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    stepOrder: row.step_order,
    delaySeconds: row.delay_seconds,
    absoluteDatetime: row.absolute_datetime,
    messageType: row.message_type,
    messagePayload: row.message_payload,
    conditionConfig: row.condition_config,
    createdAt: row.created_at,
  };
}

export function createScenarioEngine(deps: ScenarioEngineDeps): ScenarioEngineService {
  const { db } = deps;

  async function insertSteps(scenarioId: string, steps: CreateScenarioInput["steps"]): Promise<StepView[]> {
    const now = Math.floor(Date.now() / 1000);
    const views: StepView[] = [];
    for (const step of steps) {
      const id = generateId();
      await db
        .prepare(
          `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_seconds, absolute_datetime, message_type, message_payload, condition_config, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          scenarioId,
          step.step_order,
          step.delay_seconds,
          step.absolute_datetime,
          step.message_type,
          step.message_payload,
          step.condition_config ? JSON.stringify(step.condition_config) : null,
          now,
        )
        .run();
      views.push({
        id,
        scenarioId,
        stepOrder: step.step_order,
        delaySeconds: step.delay_seconds,
        absoluteDatetime: step.absolute_datetime,
        messageType: step.message_type,
        messagePayload: step.message_payload,
        conditionConfig: step.condition_config ? JSON.stringify(step.condition_config) : null,
        createdAt: now,
      });
    }
    return views;
  }

  async function fetchSteps(scenarioId: string): Promise<ScenarioStep[]> {
    const result = await db
      .prepare("SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC")
      .bind(scenarioId)
      .all<ScenarioStep>();
    return result.results ?? [];
  }

  return {
    async createScenario(accountId, input) {
      const parsed = CreateScenarioInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(createAppError("VALIDATION_ERROR", parsed.error.message));
      }
      const data = parsed.data;

      const id = generateId();
      const now = Math.floor(Date.now() / 1000);

      await db
        .prepare(
          `INSERT INTO scenarios (id, account_id, name, trigger_type, trigger_config, is_active, bot_disclosure_enabled, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          id,
          accountId,
          data.name,
          data.trigger_type,
          data.trigger_config,
          1,
          data.bot_disclosure_enabled ? 1 : 0,
          now,
          now,
        )
        .run();

      const stepViews = await insertSteps(id, data.steps);

      return ok({
        id,
        accountId,
        name: data.name,
        triggerType: data.trigger_type,
        triggerConfig: data.trigger_config,
        isActive: true,
        botDisclosureEnabled: data.bot_disclosure_enabled,
        version: 1,
        createdAt: now,
        updatedAt: now,
        steps: stepViews,
      });
    },

    async getScenario(scenarioId, accountId) {
      const row = await db
        .prepare("SELECT * FROM scenarios WHERE id = ? AND account_id = ?")
        .bind(scenarioId, accountId)
        .first<Scenario>();

      if (!row) {
        return err(createAppError("NOT_FOUND", `Scenario ${scenarioId} not found`));
      }

      const steps = await fetchSteps(scenarioId);
      return ok(toScenarioView(row, steps));
    },

    async listScenarios(accountId) {
      const result = await db
        .prepare("SELECT * FROM scenarios WHERE account_id = ? ORDER BY created_at DESC")
        .bind(accountId)
        .all<Scenario>();

      const scenarios = result.results ?? [];
      const views: ScenarioView[] = [];
      for (const s of scenarios) {
        const steps = await fetchSteps(s.id);
        views.push(toScenarioView(s, steps));
      }
      return ok(views);
    },

    async updateScenario(scenarioId, accountId, input) {
      const existing = await db
        .prepare("SELECT * FROM scenarios WHERE id = ? AND account_id = ?")
        .bind(scenarioId, accountId)
        .first<Scenario>();

      if (!existing) {
        return err(createAppError("NOT_FOUND", `Scenario ${scenarioId} not found`));
      }

      if (existing.version !== input.version) {
        return err(
          createAppError("CONFLICT", `Version conflict: expected ${existing.version}, got ${input.version}`),
        );
      }

      const now = Math.floor(Date.now() / 1000);
      const name = input.name ?? existing.name;
      const triggerType = input.trigger_type ?? existing.trigger_type;
      const triggerConfig = input.trigger_config ?? existing.trigger_config;
      const isActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active;
      const botDisclosure = input.bot_disclosure_enabled !== undefined
        ? (input.bot_disclosure_enabled ? 1 : 0)
        : existing.bot_disclosure_enabled;

      const updateResult = await db
        .prepare(
          `UPDATE scenarios SET name = ?, trigger_type = ?, trigger_config = ?, is_active = ?, bot_disclosure_enabled = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND account_id = ? AND version = ?`,
        )
        .bind(name, triggerType, triggerConfig, isActive, botDisclosure, now, scenarioId, accountId, input.version)
        .run();

      if ((updateResult.meta as { changes?: number })?.changes === 0) {
        return err(
          createAppError("CONFLICT", "Update failed due to concurrent modification, please retry"),
        );
      }

      if (input.steps) {
        await db
          .prepare("DELETE FROM scenario_steps WHERE scenario_id = ?")
          .bind(scenarioId)
          .run();
        await insertSteps(scenarioId, input.steps);
      }

      const updated = await db
        .prepare("SELECT * FROM scenarios WHERE id = ? AND account_id = ?")
        .bind(scenarioId, accountId)
        .first<Scenario>();

      const steps = await fetchSteps(scenarioId);
      return ok(toScenarioView(updated!, steps));
    },

    async deleteScenario(scenarioId, accountId) {
      const existing = await db
        .prepare("SELECT * FROM scenarios WHERE id = ? AND account_id = ?")
        .bind(scenarioId, accountId)
        .first<Scenario>();

      if (!existing) {
        return err(createAppError("NOT_FOUND", `Scenario ${scenarioId} not found`));
      }

      await db
        .prepare("DELETE FROM scenario_steps WHERE scenario_id = ?")
        .bind(scenarioId)
        .run();

      await db
        .prepare("DELETE FROM scenarios WHERE id = ? AND account_id = ?")
        .bind(scenarioId, accountId)
        .run();

      return ok(undefined);
    },
  };
}
