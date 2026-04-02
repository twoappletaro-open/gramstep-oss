import type { Result, AppError, PackageButton, TriggerAction } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import { parsePackageBody, serializePackageBody } from "./package-format.js";

// ────────── Export Types ──────────

export interface ExportedStep {
  step_order: number;
  delay_seconds: number;
  absolute_datetime: number | null;
  message_type: string;
  message_payload: string;
  condition_config: string | null;
}

export interface ExportedScenario {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: string;
  is_active: boolean;
  bot_disclosure_enabled: boolean;
  steps: ExportedStep[];
}

export interface ExportedTrigger {
  name: string;
  trigger_type: string;
  match_type: string;
  keywords: string[];
  actions: TriggerAction[];
  schedule_config: string | null;
  fire_mode: string;
  is_active: boolean;
}

export interface ExportedTemplate {
  id: string;
  name: string;
  type: string;
  body: string;
  variables: unknown[];
  is_active: boolean;
}

export interface AccountConfigExport {
  version: number;
  exportedAt: number;
  sourceAccountId: string;
  scenarios: ExportedScenario[];
  triggers: ExportedTrigger[];
  templates: ExportedTemplate[];
}

// ────────── Import Result ──────────

export interface ConfigImportResult {
  scenariosImported: number;
  triggersImported: number;
  templatesImported: number;
}

// ────────── Service Interface ──────────

export interface AccountConfigCopyService {
  exportConfig(accountId: string): Promise<Result<AccountConfigExport, AppError>>;
  importConfig(
    targetAccountId: string,
    data: AccountConfigExport,
  ): Promise<Result<ConfigImportResult, AppError>>;
}

// ────────── Dependencies ──────────

export interface AccountConfigCopyDeps {
  db: D1Database;
  generateId: () => string;
  now: () => number;
}

function remapTemplateReferencesInBody(body: string, templateIdMap: Map<string, string>): string {
  const packageBody = parsePackageBody(body);
  if (!packageBody) {
    return body;
  }

  function remapPackageId(packageId: string | undefined): string | undefined {
    return packageId ? (templateIdMap.get(packageId) ?? packageId) : packageId;
  }

  return serializePackageBody(
    packageBody.text,
    packageBody.buttons.map((button: PackageButton) => ({
      ...button,
      action: (() => {
        const selectionMode = button.action.selectionMode
          ?? (button.action.useFollowerCondition ? "follower_condition" : "specific");

        if (selectionMode === "follower_condition") {
          return {
            ...button.action,
            followerPackageId: remapPackageId(button.action.followerPackageId),
            nonFollowerPackageId: remapPackageId(button.action.nonFollowerPackageId),
          };
        }

        if (selectionMode === "random") {
          return {
            ...button.action,
            packageIds: (button.action.packageIds ?? []).map(
              (packageId: string) => templateIdMap.get(packageId) ?? packageId,
            ),
          };
        }

        return {
          ...button.action,
          packageId: remapPackageId(button.action.packageId),
        };
      })(),
    })),
  );
}

// ────────── DB Row Types ──────────

interface ScenarioRow {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: string;
  is_active: number;
  bot_disclosure_enabled: number;
}

interface StepRow {
  scenario_id: string;
  step_order: number;
  delay_seconds: number;
  absolute_datetime: number | null;
  message_type: string;
  message_payload: string;
  condition_config: string | null;
}

interface TriggerRow {
  name: string;
  trigger_type: string;
  match_type: string;
  keywords: string;
  actions: string;
  schedule_config: string | null;
  fire_mode: string;
  is_active: number;
}

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  body: string;
  variables: string;
  is_active: number;
}

// ────────── Constants ──────────

const CURRENT_EXPORT_VERSION = 1;

// ────────── Factory ──────────

export function createAccountConfigCopyService(
  deps: AccountConfigCopyDeps,
): AccountConfigCopyService {
  const { db, generateId, now } = deps;

  return {
    async exportConfig(accountId) {
      try {
        // Fetch scenarios
        const scenarioResult = await db
          .prepare(
            `SELECT id, name, trigger_type, trigger_config, is_active, bot_disclosure_enabled
             FROM scenarios WHERE account_id = ?`,
          )
          .bind(accountId)
          .all<ScenarioRow>();

        const scenarios: ExportedScenario[] = [];

        for (const sc of scenarioResult.results) {
          // Fetch steps for each scenario
          const stepsResult = await db
            .prepare(
              `SELECT scenario_id, step_order, delay_seconds, absolute_datetime, message_type, message_payload, condition_config
               FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
            )
            .bind(sc.id)
            .all<StepRow>();

          scenarios.push({
            id: sc.id,
            name: sc.name,
            trigger_type: sc.trigger_type,
            trigger_config: sc.trigger_config,
            is_active: sc.is_active === 1,
            bot_disclosure_enabled: sc.bot_disclosure_enabled === 1,
            steps: stepsResult.results.map((s) => ({
              step_order: s.step_order,
              delay_seconds: s.delay_seconds,
              absolute_datetime: s.absolute_datetime,
              message_type: s.message_type,
              message_payload: s.message_payload,
              condition_config: s.condition_config,
            })),
          });
        }

        // Fetch triggers
        const triggerResult = await db
          .prepare(
            `SELECT name, trigger_type, match_type, keywords, actions, schedule_config, fire_mode, is_active
             FROM triggers WHERE account_id = ?`,
          )
          .bind(accountId)
          .all<TriggerRow>();

        const triggers: ExportedTrigger[] = triggerResult.results.map((t) => ({
          name: t.name,
          trigger_type: t.trigger_type,
          match_type: t.match_type,
          keywords: JSON.parse(t.keywords) as string[],
          actions: JSON.parse(t.actions) as TriggerAction[],
          schedule_config: t.schedule_config,
          fire_mode: t.fire_mode,
          is_active: t.is_active === 1,
        }));

        // Fetch templates
        const templateResult = await db
          .prepare(
            `SELECT id, name, type, body, variables, is_active
             FROM templates WHERE account_id = ?`,
          )
          .bind(accountId)
          .all<TemplateRow>();

        const templates: ExportedTemplate[] = templateResult.results.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          body: t.body,
          variables: JSON.parse(t.variables) as unknown[],
          is_active: t.is_active === 1,
        }));

        return ok({
          version: CURRENT_EXPORT_VERSION,
          exportedAt: now(),
          sourceAccountId: accountId,
          scenarios,
          triggers,
          templates,
        });
      } catch (e: unknown) {
        return err(
          createAppError("D1_ERROR", e instanceof Error ? e.message : "Export failed"),
        );
      }
    },

    async importConfig(targetAccountId, data) {
      // Validate version
      if (!data || data.version !== CURRENT_EXPORT_VERSION) {
        return err(
          createAppError(
            "VALIDATION_ERROR",
            `Unsupported export version: ${data?.version}. Expected: ${CURRENT_EXPORT_VERSION}`,
          ),
        );
      }

      if (!Array.isArray(data.scenarios) || !Array.isArray(data.triggers) || !Array.isArray(data.templates)) {
        return err(
          createAppError("VALIDATION_ERROR", "Invalid export data: scenarios, triggers, and templates must be arrays"),
        );
      }

      try {
        const currentTime = now();
        let scenariosImported = 0;
        let triggersImported = 0;
        let templatesImported = 0;

        // Import scenarios with steps (collect ID map for trigger remapping)
        const scenarioIdMap = new Map<string, string>();
        for (const sc of data.scenarios) {
          const scenarioId = generateId();
          scenarioIdMap.set(sc.id, scenarioId);
          await db
            .prepare(
              `INSERT INTO scenarios (id, account_id, name, trigger_type, trigger_config, is_active, bot_disclosure_enabled, version, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            )
            .bind(
              scenarioId,
              targetAccountId,
              sc.name,
              sc.trigger_type,
              sc.trigger_config,
              sc.is_active ? 1 : 0,
              sc.bot_disclosure_enabled ? 1 : 0,
              currentTime,
              currentTime,
            )
            .run();

          for (const step of sc.steps ?? []) {
            const stepId = generateId();
            await db
              .prepare(
                `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_seconds, absolute_datetime, message_type, message_payload, condition_config, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                stepId,
                scenarioId,
                step.step_order,
                step.delay_seconds,
                step.absolute_datetime,
                step.message_type,
                step.message_payload,
                step.condition_config,
                currentTime,
              )
              .run();
          }

          scenariosImported++;
        }

        // Import templates (before triggers, for ID remapping)
        const templateIdMap = new Map<string, string>();
        for (const tpl of data.templates) {
          templateIdMap.set(tpl.id, generateId());
        }

        for (const tpl of data.templates) {
          const newTemplateId = templateIdMap.get(tpl.id) ?? generateId();
          await db
            .prepare(
              `INSERT INTO templates (id, account_id, name, type, body, variables, version, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
            )
            .bind(
              newTemplateId,
              targetAccountId,
              tpl.name,
              tpl.type,
              remapTemplateReferencesInBody(tpl.body, templateIdMap),
              JSON.stringify(tpl.variables),
              tpl.is_active ? 1 : 0,
              currentTime,
              currentTime,
            )
            .run();

          templatesImported++;
        }

        // Import triggers (after templates/scenarios for ID remapping)

        for (const tr of data.triggers) {
          const triggerId = generateId();
          // Remap template/scenario IDs in trigger actions
          const remappedActions = (tr.actions as Array<Record<string, unknown>>).map((a) => {
            if (a.type === "send_template" && typeof a.templateId === "string") {
              return { ...a, templateId: templateIdMap.get(a.templateId) ?? a.templateId };
            }
            if (
              a.type === "send_template_by_follower_status"
              && typeof a.followerTemplateId === "string"
              && typeof a.nonFollowerTemplateId === "string"
            ) {
              return {
                ...a,
                followerTemplateId: templateIdMap.get(a.followerTemplateId) ?? a.followerTemplateId,
                nonFollowerTemplateId: templateIdMap.get(a.nonFollowerTemplateId) ?? a.nonFollowerTemplateId,
              };
            }
            if (a.type === "enroll_scenario" && typeof a.scenarioId === "string") {
              return { ...a, scenarioId: scenarioIdMap.get(a.scenarioId) ?? a.scenarioId };
            }
            if (a.type === "start_survey" && typeof a.surveyId === "string") {
              return a;
            }
            return a;
          });

          await db
            .prepare(
              `INSERT INTO triggers (id, account_id, name, trigger_type, match_type, keywords, actions, schedule_config, fire_mode, is_active, version, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            )
            .bind(
              triggerId,
              targetAccountId,
              tr.name,
              tr.trigger_type,
              tr.match_type,
              JSON.stringify(tr.keywords),
              JSON.stringify(remappedActions),
              tr.schedule_config,
              tr.fire_mode,
              tr.is_active ? 1 : 0,
              currentTime,
              currentTime,
            )
            .run();

          triggersImported++;
        }

        return ok({ scenariosImported, triggersImported, templatesImported });
      } catch (e: unknown) {
        return err(
          createAppError("D1_ERROR", e instanceof Error ? e.message : "Import failed"),
        );
      }
    },
  };
}
