import { generateId } from "@gramstep/db";
import type { Trigger } from "@gramstep/db";
import type {
  Result,
  AppError,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerAction,
  TriggerType,
  MatchType,
  FireMode,
  ScheduleConfig,
} from "@gramstep/shared";
import { ok, err, createAppError, CreateTriggerInputSchema, ScheduleConfigSchema } from "@gramstep/shared";

export interface TriggerView {
  id: string;
  accountId: string;
  name: string;
  triggerType: TriggerType;
  matchType: MatchType;
  keywords: string[];
  actions: TriggerAction[];
  scheduleConfig: ScheduleConfig | null;
  fireMode: FireMode;
  isActive: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface TriggerMatch {
  triggerId: string;
  triggerType: TriggerType;
  matchedKeyword?: string;
  actions: TriggerAction[];
}

export interface WebhookEventInput {
  type: TriggerType;
  text: string;
}

export interface TriggerEngineService {
  createTrigger(accountId: string, input: CreateTriggerInput): Promise<Result<TriggerView, AppError>>;
  getTrigger(triggerId: string, accountId: string): Promise<Result<TriggerView, AppError>>;
  listTriggers(accountId: string, type?: TriggerType): Promise<Result<TriggerView[], AppError>>;
  updateTrigger(triggerId: string, accountId: string, input: UpdateTriggerInput): Promise<Result<TriggerView, AppError>>;
  deleteTrigger(triggerId: string, accountId: string): Promise<Result<void, AppError>>;
  evaluateTriggers(
    event: WebhookEventInput,
    accountId: string,
    igUserId: string,
    now?: Date,
  ): Promise<Result<TriggerMatch[], AppError>>;
}

export interface TriggerEngineDeps {
  db: D1Database;
}

function toTriggerView(row: Trigger): TriggerView {
  const keywords: string[] = JSON.parse(row.keywords);
  const actions: TriggerAction[] = JSON.parse(row.actions);
  const scheduleConfig: ScheduleConfig | null = row.schedule_config
    ? ScheduleConfigSchema.parse(JSON.parse(row.schedule_config))
    : null;

  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    triggerType: row.trigger_type as TriggerType,
    matchType: row.match_type as MatchType,
    keywords,
    actions,
    scheduleConfig,
    fireMode: row.fire_mode as FireMode,
    isActive: row.is_active === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function matchKeyword(
  text: string,
  keywords: string[],
  matchType: MatchType,
): string | undefined {
  if (keywords.length === 0) return "";

  for (const kw of keywords) {
    switch (matchType) {
      case "exact":
        if (text === kw) return kw;
        break;
      case "partial":
        if (text.includes(kw)) return kw;
        break;
      case "regex":
        try {
          if (new RegExp(kw, "i").test(text)) return kw;
        } catch {
          // invalid regex — skip
        }
        break;
    }
  }
  return undefined;
}

function isWithinSchedule(schedule: ScheduleConfig, now: Date): boolean {
  const dayOfWeek = now.getUTCDay();
  if (!schedule.days_of_week.includes(dayOfWeek)) return false;

  const hour = now.getUTCHours();
  if (schedule.start_hour <= schedule.end_hour) {
    if (hour < schedule.start_hour || hour > schedule.end_hour) return false;
  } else {
    // overnight range (e.g. 22-6)
    if (hour < schedule.start_hour && hour > schedule.end_hour) return false;
  }

  const nowEpoch = Math.floor(now.getTime() / 1000);
  if (schedule.start_date !== null && nowEpoch < schedule.start_date) return false;
  if (schedule.end_date !== null && nowEpoch > schedule.end_date) return false;

  return true;
}

export function createTriggerEngine(deps: TriggerEngineDeps): TriggerEngineService {
  const { db } = deps;

  return {
    async createTrigger(accountId, input) {
      const parsed = CreateTriggerInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(createAppError("VALIDATION_ERROR", parsed.error.message));
      }
      const data = parsed.data;

      const id = generateId();
      const now = Math.floor(Date.now() / 1000);

      await db
        .prepare(
          `INSERT INTO triggers (id, account_id, name, trigger_type, match_type, keywords, actions, schedule_config, fire_mode, is_active, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          id,
          accountId,
          data.name,
          data.trigger_type,
          data.match_type,
          JSON.stringify(data.keywords),
          JSON.stringify(data.actions),
          data.schedule_config ? JSON.stringify(data.schedule_config) : null,
          data.fire_mode,
          data.is_active ? 1 : 0,
          now,
          now,
        )
        .run();

      return ok({
        id,
        accountId,
        name: data.name,
        triggerType: data.trigger_type,
        matchType: data.match_type,
        keywords: data.keywords,
        actions: data.actions,
        scheduleConfig: data.schedule_config,
        fireMode: data.fire_mode,
        isActive: data.is_active,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    },

    async getTrigger(triggerId, accountId) {
      const row = await db
        .prepare("SELECT * FROM triggers WHERE id = ? AND account_id = ?")
        .bind(triggerId, accountId)
        .first<Trigger>();

      if (!row) {
        return err(createAppError("NOT_FOUND", `Trigger ${triggerId} not found`));
      }

      return ok(toTriggerView(row));
    },

    async listTriggers(accountId, type?) {
      const query = type
        ? "SELECT * FROM triggers WHERE account_id = ? AND trigger_type = ? ORDER BY created_at DESC"
        : "SELECT * FROM triggers WHERE account_id = ? ORDER BY created_at DESC";

      const bindings = type ? [accountId, type] : [accountId];
      const stmt = db.prepare(query);
      const result = await stmt.bind(...bindings).all<Trigger>();

      const views = (result.results ?? []).map(toTriggerView);
      return ok(views);
    },

    async updateTrigger(triggerId, accountId, input) {
      const existing = await db
        .prepare("SELECT * FROM triggers WHERE id = ? AND account_id = ?")
        .bind(triggerId, accountId)
        .first<Trigger>();

      if (!existing) {
        return err(createAppError("NOT_FOUND", `Trigger ${triggerId} not found`));
      }

      if (existing.version !== input.version) {
        return err(
          createAppError("CONFLICT", `Version conflict: expected ${existing.version}, got ${input.version}`),
        );
      }

      const now = Math.floor(Date.now() / 1000);
      const name = input.name ?? existing.name;
      const triggerType = input.trigger_type ?? existing.trigger_type;
      const matchType = input.match_type ?? existing.match_type;
      const keywords = input.keywords ? JSON.stringify(input.keywords) : existing.keywords;
      const actions = input.actions ? JSON.stringify(input.actions) : existing.actions;
      const scheduleConfig = input.schedule_config !== undefined
        ? (input.schedule_config ? JSON.stringify(input.schedule_config) : null)
        : existing.schedule_config;
      const fireMode = input.fire_mode ?? existing.fire_mode;
      const isActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active;

      const updateResult = await db
        .prepare(
          `UPDATE triggers SET name = ?, trigger_type = ?, match_type = ?, keywords = ?, actions = ?, schedule_config = ?, fire_mode = ?, is_active = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND account_id = ? AND version = ?`,
        )
        .bind(
          name,
          triggerType,
          matchType,
          keywords,
          actions,
          scheduleConfig,
          fireMode,
          isActive,
          now,
          triggerId,
          accountId,
          input.version,
        )
        .run();

      if ((updateResult.meta as { changes?: number })?.changes === 0) {
        return err(
          createAppError("CONFLICT", "Update failed due to concurrent modification, please retry"),
        );
      }

      const updated = await db
        .prepare("SELECT * FROM triggers WHERE id = ? AND account_id = ?")
        .bind(triggerId, accountId)
        .first<Trigger>();

      return ok(toTriggerView(updated!));
    },

    async deleteTrigger(triggerId, accountId) {
      const existing = await db
        .prepare("SELECT * FROM triggers WHERE id = ? AND account_id = ?")
        .bind(triggerId, accountId)
        .first<Trigger>();

      if (!existing) {
        return err(createAppError("NOT_FOUND", `Trigger ${triggerId} not found`));
      }

      await db
        .prepare("DELETE FROM trigger_fire_logs WHERE trigger_id = ?")
        .bind(triggerId)
        .run();

      await db
        .prepare("DELETE FROM triggers WHERE id = ? AND account_id = ?")
        .bind(triggerId, accountId)
        .run();

      return ok(undefined);
    },

    async evaluateTriggers(event, accountId, igUserId, now?) {
      const currentTime = now ?? new Date();
      const result = await db
        .prepare("SELECT * FROM triggers WHERE account_id = ? AND is_active = 1 ORDER BY created_at DESC")
        .bind(accountId)
        .all<Trigger>();

      const triggers = result.results ?? [];
      const matches: TriggerMatch[] = [];

      for (const trigger of triggers) {
        const view = toTriggerView(trigger);

        // Check trigger type matches event type
        if (view.triggerType !== event.type) continue;

        // Check schedule
        if (view.scheduleConfig && !isWithinSchedule(view.scheduleConfig, currentTime)) continue;

        // Check fire mode
        if (view.fireMode === "once" || view.fireMode === "first_only") {
          const countResult = await db
            .prepare("SELECT COUNT(*) as count FROM trigger_fire_logs WHERE trigger_id = ? AND ig_user_id = ?")
            .bind(trigger.id, igUserId)
            .first<{ count: number }>();

          if (countResult && countResult.count > 0) continue;
        }

        // Check keyword matching
        const matched = matchKeyword(event.text, view.keywords, view.matchType);
        if (matched === undefined) continue;

        matches.push({
          triggerId: trigger.id,
          triggerType: view.triggerType,
          matchedKeyword: matched || undefined,
          actions: view.actions,
        });
      }

      return ok(matches);
    },
  };
}
