import { generateId } from "@gramstep/db";
import type { TestAccount, Scenario, ScenarioStep, Trigger } from "@gramstep/db";
import type { Result, AppError, TriggerAction, TriggerType, MatchType } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

// --- View Types ---

export interface TestAccountView {
  id: string;
  accountId: string;
  igScopedId: string;
  createdAt: number;
}

export interface DryRunStepResult {
  stepOrder: number;
  scheduledDeliveryTime: string;
  messagePreview: string;
  conditionResult: "matched" | "skipped" | "branched";
  branchedTo?: number;
}

export interface DryRunResult {
  steps: DryRunStepResult[];
  totalSteps: number;
  estimatedDuration: string;
}

export interface TriggerSimulationResult {
  triggersMatched: { triggerId: string; triggerName: string }[];
  actionsExecuted: { action: string; target: string }[];
}

// --- Service Interface ---

export interface TestModeService {
  registerTestAccount(accountId: string, igScopedId: string): Promise<Result<TestAccountView, AppError>>;
  listTestAccounts(accountId: string): Promise<Result<TestAccountView[], AppError>>;
  deleteTestAccount(testAccountId: string, accountId: string): Promise<Result<void, AppError>>;
  dryRunScenario(scenarioId: string, testAccountId: string, accountId: string): Promise<Result<DryRunResult, AppError>>;
  simulateTrigger(triggerId: string, accountId: string, eventPayload: { type: string; text: string }): Promise<Result<TriggerSimulationResult, AppError>>;
}

export interface TestModeServiceDeps {
  db: D1Database;
  now: () => number;
}

// --- Helpers ---

function toTestAccountView(row: TestAccount): TestAccountView {
  return {
    id: row.id,
    accountId: row.account_id,
    igScopedId: row.ig_scoped_id,
    createdAt: row.created_at,
  };
}

function extractMessagePreview(messagePayload: string): string {
  try {
    const parsed = JSON.parse(messagePayload) as Record<string, unknown>;
    if (typeof parsed.text === "string") return parsed.text;
    return messagePayload.slice(0, 100);
  } catch {
    return messagePayload.slice(0, 100);
  }
}

function matchKeyword(text: string, keywords: string[], matchType: MatchType): boolean {
  if (keywords.length === 0) return true;
  for (const kw of keywords) {
    switch (matchType) {
      case "exact":
        if (text === kw) return true;
        break;
      case "partial":
        if (text.includes(kw)) return true;
        break;
      case "regex":
        try {
          if (new RegExp(kw, "i").test(text)) return true;
        } catch {
          // invalid regex — skip
        }
        break;
    }
  }
  return false;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds === 0) return "即時";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}日`);
  if (hours > 0) parts.push(`${hours}時間`);
  if (minutes > 0) parts.push(`${minutes}分`);
  return parts.length > 0 ? parts.join("") : `${totalSeconds}秒`;
}

function actionToDescription(action: TriggerAction): { action: string; target: string } {
  switch (action.type) {
    case "send_template":
      return { action: "send_template", target: action.templateId };
    case "add_tag":
      return { action: "add_tag", target: action.tagId };
    case "remove_tag":
      return { action: "remove_tag", target: action.tagId };
    case "enroll_scenario":
      return { action: "enroll_scenario", target: action.scenarioId };
    case "start_survey":
      return { action: "start_survey", target: action.surveyId };
    case "webhook":
      return { action: "webhook", target: action.url };
    case "update_metadata":
      return { action: "update_metadata", target: `${action.key}=${action.value}` };
    case "update_score":
      return { action: "update_score", target: String(action.delta) };
    case "send_reaction":
      return { action: "send_reaction", target: action.emoji };
    case "enter_campaign":
      return { action: "enter_campaign", target: action.campaignId };
  }
}

// --- Factory ---

export function createTestModeService(deps: TestModeServiceDeps): TestModeService {
  const { db, now } = deps;

  return {
    async registerTestAccount(accountId, igScopedId) {
      if (!igScopedId || igScopedId.trim().length === 0) {
        return err(createAppError("VALIDATION_ERROR", "igScopedId is required"));
      }

      // 重複チェック
      const existing = await db
        .prepare("SELECT id FROM test_accounts WHERE account_id = ? AND ig_scoped_id = ?")
        .bind(accountId, igScopedId)
        .first<{ id: string }>();

      if (existing) {
        return err(createAppError("DUPLICATE", `Test account with IGSID ${igScopedId} already exists`));
      }

      const id = generateId();
      const createdAt = now();

      await db
        .prepare(
          "INSERT INTO test_accounts (id, account_id, ig_scoped_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(id, accountId, igScopedId, createdAt)
        .run();

      return ok({
        id,
        accountId,
        igScopedId,
        createdAt,
      });
    },

    async listTestAccounts(accountId) {
      const result = await db
        .prepare("SELECT * FROM test_accounts WHERE account_id = ? ORDER BY created_at DESC")
        .bind(accountId)
        .all<TestAccount>();

      return ok((result.results ?? []).map(toTestAccountView));
    },

    async deleteTestAccount(testAccountId, accountId) {
      const existing = await db
        .prepare("SELECT * FROM test_accounts WHERE id = ? AND account_id = ?")
        .bind(testAccountId, accountId)
        .first<TestAccount>();

      if (!existing) {
        return err(createAppError("NOT_FOUND", `Test account ${testAccountId} not found`));
      }

      await db
        .prepare("DELETE FROM test_accounts WHERE id = ? AND account_id = ?")
        .bind(testAccountId, accountId)
        .run();

      return ok(undefined);
    },

    async dryRunScenario(scenarioId, testAccountId, accountId) {
      // Verify test account exists
      const testAccount = await db
        .prepare("SELECT * FROM test_accounts WHERE id = ? AND account_id = ?")
        .bind(testAccountId, accountId)
        .first<TestAccount>();

      if (!testAccount) {
        return err(createAppError("NOT_FOUND", `Test account ${testAccountId} not found`));
      }

      // Fetch scenario
      const scenario = await db
        .prepare("SELECT * FROM scenarios WHERE id = ? AND account_id = ?")
        .bind(scenarioId, accountId)
        .first<Scenario>();

      if (!scenario) {
        return err(createAppError("NOT_FOUND", `Scenario ${scenarioId} not found`));
      }

      // Fetch steps
      const stepsResult = await db
        .prepare("SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC")
        .bind(scenarioId)
        .all<ScenarioStep>();

      const steps = stepsResult.results ?? [];
      const baseTime = now();
      let cumulativeDelay = 0;

      const dryRunSteps: DryRunStepResult[] = [];

      for (const step of steps) {
        cumulativeDelay += step.delay_seconds;
        const scheduledTime = baseTime + cumulativeDelay;
        const scheduledDate = new Date(scheduledTime * 1000);

        let conditionResult: "matched" | "skipped" | "branched" = "matched";
        let branchedTo: number | undefined;

        if (step.condition_config) {
          try {
            const config = JSON.parse(step.condition_config) as {
              type: string;
              conditions: Array<{ next_step_order: number }>;
              default_next_step_order: number;
            };
            if (config.type === "branch") {
              // In dry run, we take the default path and report it as branched
              conditionResult = "branched";
              branchedTo = config.default_next_step_order;
            }
          } catch {
            // Invalid config, treat as matched
          }
        }

        dryRunSteps.push({
          stepOrder: step.step_order,
          scheduledDeliveryTime: scheduledDate.toISOString(),
          messagePreview: extractMessagePreview(step.message_payload),
          conditionResult,
          branchedTo,
        });
      }

      return ok({
        steps: dryRunSteps,
        totalSteps: steps.length,
        estimatedDuration: formatDuration(cumulativeDelay),
      });
    },

    async simulateTrigger(triggerId, accountId, eventPayload) {
      const trigger = await db
        .prepare("SELECT * FROM triggers WHERE id = ? AND account_id = ?")
        .bind(triggerId, accountId)
        .first<Trigger>();

      if (!trigger) {
        return err(createAppError("NOT_FOUND", `Trigger ${triggerId} not found`));
      }

      const triggerType = trigger.trigger_type as TriggerType;
      const matchType = trigger.match_type as MatchType;
      const keywords: string[] = JSON.parse(trigger.keywords);
      const actions: TriggerAction[] = JSON.parse(trigger.actions);

      // Check type match
      if (triggerType !== eventPayload.type) {
        return ok({ triggersMatched: [], actionsExecuted: [] });
      }

      // Check keyword match
      if (!matchKeyword(eventPayload.text, keywords, matchType)) {
        return ok({ triggersMatched: [], actionsExecuted: [] });
      }

      return ok({
        triggersMatched: [{ triggerId: trigger.id, triggerName: trigger.name }],
        actionsExecuted: actions.map(actionToDescription),
      });
    },
  };
}
