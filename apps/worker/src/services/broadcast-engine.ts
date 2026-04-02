import type { Result } from "@gramstep/shared";
import type { AppError, SegmentFilter, SegmentCondition, CreateBroadcastInput, AccountSettings } from "@gramstep/shared";
import type { IgUser } from "@gramstep/db";
import { ok, err, createAppError, AccountSettingsSchema } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface BroadcastView {
  id: string;
  account_id: string;
  name: string;
  template_id: string;
  segment: SegmentFilter;
  status: string;
  scheduled_at: number | null;
  total_recipients: number;
  sent_count: number;
  skipped_count: number;
  failed_count: number;
  created_at: number;
  completed_at: number | null;
}

export interface BroadcastExecutionResult {
  sent: number;
  skipped: number;
  failed: number;
}

export interface BroadcastEngineService {
  createBroadcast(
    accountId: string,
    input: CreateBroadcastInput,
  ): Promise<Result<BroadcastView, AppError>>;
  querySegment(
    accountId: string,
    segment: SegmentFilter,
  ): Promise<Result<Array<Pick<IgUser, "id" | "ig_scoped_id" | "account_id">>, AppError>>;
  executeBroadcast(
    accountId: string,
    broadcastId: string,
    segment: SegmentFilter,
    templateId: string,
  ): Promise<Result<BroadcastExecutionResult, AppError>>;
}

export interface BroadcastEngineDeps {
  db: D1Database;
  sendQueue: Queue;
  now: () => number;
  _sentMessages?: unknown[];
}

function buildSegmentWhere(
  conditions: SegmentCondition[],
  logic: "and" | "or",
): { where: string; bindings: unknown[]; joins: string[] } {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  const joins: string[] = [];
  let tagJoinIndex = 0;

  for (const cond of conditions) {
    switch (cond.field) {
      case "tag": {
        const alias = `iut${tagJoinIndex++}`;
        if (cond.operator === "has") {
          joins.push(
            `INNER JOIN ig_user_tags ${alias} ON ${alias}.ig_user_id = u.id INNER JOIN tags t${alias} ON t${alias}.id = ${alias}.tag_id AND t${alias}.name = ?`,
          );
          bindings.push(String(cond.value));
        } else {
          // not_has
          clauses.push(
            `u.id NOT IN (SELECT iut.ig_user_id FROM ig_user_tags iut INNER JOIN tags t ON t.id = iut.tag_id WHERE t.name = ? AND t.account_id = u.account_id)`,
          );
          bindings.push(String(cond.value));
        }
        break;
      }
      case "score": {
        const op = sqlOperator(cond.operator);
        clauses.push(`u.score ${op} ?`);
        bindings.push(Number(cond.value));
        break;
      }
      case "follower_status": {
        const op = sqlOperator(cond.operator);
        clauses.push(`u.follower_status ${op} ?`);
        bindings.push(String(cond.value));
        break;
      }
      case "metadata": {
        const key = cond.key ?? "";
        const op = sqlOperator(cond.operator);
        clauses.push(`JSON_EXTRACT(u.metadata, ?) ${op} ?`);
        bindings.push(`$.${key}`);
        bindings.push(cond.value);
        break;
      }
    }
  }

  const connector = logic === "and" ? " AND " : " OR ";
  const where = clauses.length > 0 ? clauses.join(connector) : "1=1";

  return { where, bindings, joins };
}

function sqlOperator(op: string): string {
  switch (op) {
    case "eq":
      return "=";
    case "neq":
      return "!=";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
    default:
      return "=";
  }
}

/**
 * Get the current hour in the given timezone.
 * Returns 0-23. Falls back to UTC if timezone is null/invalid.
 */
function getCurrentHourInTimezone(unixSeconds: number, timezone: string | null): number {
  const date = new Date(unixSeconds * 1000);
  try {
    const tz = timezone ?? "UTC";
    const formatted = date.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false });
    const hour = parseInt(formatted, 10);
    return isNaN(hour) ? date.getUTCHours() : hour % 24;
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Check if the current hour is within the delivery window.
 * start === end means 24h (always open).
 */
function isWithinDeliveryWindow(currentHour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) {
    return currentHour >= start && currentHour < end;
  }
  // Wrap-around: e.g., start=22, end=6 → 22,23,0,1,2,3,4,5
  return currentHour >= start || currentHour < end;
}

export function createBroadcastEngine(deps: BroadcastEngineDeps): BroadcastEngineService {
  const { db, sendQueue, now } = deps;

  async function getAccountInfo(
    accountId: string,
  ): Promise<Result<{ settings: AccountSettings; timezone: string | null; healthScore: string }, AppError>> {
    try {
      const row = await db
        .prepare(`SELECT settings, timezone, health_score FROM accounts WHERE id = ?`)
        .bind(accountId)
        .first<{ settings: string | null; timezone: string | null; health_score: string }>();
      if (!row) {
        return err(createAppError("NOT_FOUND", "アカウントが見つかりません"));
      }
      const parsed = AccountSettingsSchema.safeParse(
        row.settings ? JSON.parse(row.settings) : {},
      );
      const settings = parsed.success ? parsed.data : AccountSettingsSchema.parse({});
      return ok({ settings, timezone: row.timezone, healthScore: row.health_score });
    } catch (e) {
      return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Account lookup failed"));
    }
  }

  async function getWeeklyBroadcastCount(accountId: string): Promise<Result<number, AppError>> {
    const weekAgo = now() - 7 * 24 * 60 * 60;
    try {
      const result = await db
        .prepare(
          `SELECT COUNT(*) as count FROM broadcasts WHERE account_id = ? AND status = 'completed' AND completed_at >= ?`,
        )
        .bind(accountId, weekAgo)
        .first<{ count: number }>();
      return ok(result?.count ?? 0);
    } catch (e) {
      return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Weekly broadcast count failed"));
    }
  }

  async function isNoResponseUser(
    accountId: string,
    igUserId: string,
    threshold: number,
  ): Promise<boolean> {
    if (threshold <= 0) return false;
    try {
      // Count consecutive outbound broadcast messages without any inbound reply after them
      const result = await db
        .prepare(
          `SELECT COUNT(*) as count FROM message_logs
           WHERE account_id = ? AND ig_user_id = ? AND direction = 'outbound' AND source_type = 'broadcast'
           AND created_at > COALESCE(
             (SELECT MAX(created_at) FROM message_logs
              WHERE account_id = ? AND ig_user_id = ? AND direction = 'inbound'),
             0
           )`,
        )
        .bind(accountId, igUserId, accountId, igUserId)
        .first<{ count: number }>();
      return (result?.count ?? 0) >= threshold;
    } catch {
      return false;
    }
  }

  async function querySegmentImpl(
    accountId: string,
    segment: SegmentFilter,
  ): Promise<Result<Array<Pick<IgUser, "id" | "ig_scoped_id" | "account_id">>, AppError>> {
    try {
      const { where, bindings, joins } = buildSegmentWhere(segment.conditions, segment.logic);
      const joinClause = joins.join(" ");
      const query = `SELECT DISTINCT u.id, u.ig_scoped_id, u.account_id FROM ig_users u ${joinClause} WHERE u.account_id = ? AND u.is_opted_out = 0 AND u.is_deleted = 0 AND u.is_blocked = 0 AND (${where})`;
      const allBindings = [accountId, ...bindings];
      const result = await db
        .prepare(query)
        .bind(...allBindings)
        .all<Pick<IgUser, "id" | "ig_scoped_id" | "account_id">>();
      return ok(result.results);
    } catch (e) {
      return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Segment query failed"));
    }
  }

  async function getActiveWindowUserIds(
    accountId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    try {
      const placeholders = userIds.map(() => "?").join(",");
      const result = await db
        .prepare(
          `SELECT ig_user_id FROM messaging_windows WHERE account_id = ? AND ig_user_id IN (${placeholders}) AND is_active = 1 AND window_expires_at > ?`,
        )
        .bind(accountId, ...userIds, now())
        .all<{ ig_user_id: string }>();
      return new Set(result.results.map((r) => r.ig_user_id));
    } catch {
      return new Set();
    }
  }

  return {
    querySegment: querySegmentImpl,

    createBroadcast: async (accountId, input) => {
      try {
        // Verify template exists
        const template = await db
          .prepare(`SELECT id, body, type, variables FROM templates WHERE id = ? AND account_id = ?`)
          .bind(input.template_id, accountId)
          .first<{ id: string; body: string; type: string; variables: string }>();

        if (!template) {
          return err(createAppError("NOT_FOUND", "テンプレートが見つかりません"));
        }

        const isScheduled = input.scheduled_at !== null && input.scheduled_at > now();
        const status = isScheduled ? "scheduled" : "sending";
        const broadcastId = generateId();

        await db
          .prepare(
            `INSERT INTO broadcasts (id, account_id, name, template_id, segment, status, scheduled_at, total_recipients, sent_count, skipped_count, failed_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
          )
          .bind(
            broadcastId,
            accountId,
            input.name,
            input.template_id,
            JSON.stringify(input.segment),
            status,
            input.scheduled_at,
            now(),
          )
          .run();

        const view: BroadcastView = {
          id: broadcastId,
          account_id: accountId,
          name: input.name,
          template_id: input.template_id,
          segment: input.segment,
          status,
          scheduled_at: input.scheduled_at,
          total_recipients: 0,
          sent_count: 0,
          skipped_count: 0,
          failed_count: 0,
          created_at: now(),
          completed_at: null,
        };

        // If immediate, execute now
        if (!isScheduled) {
          const execResult = await execBroadcast(accountId, broadcastId, input.segment, input.template_id);
          if (!execResult.ok) {
            return execResult;
          }
          view.sent_count = execResult.value.sent;
          view.skipped_count = execResult.value.skipped;
          view.total_recipients = execResult.value.sent + execResult.value.skipped;
        }

        return ok(view);
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Broadcast creation failed"));
      }
    },

    executeBroadcast: async (accountId, broadcastId, segment, templateId) => {
      return execBroadcast(accountId, broadcastId, segment, templateId);
    },
  };

  async function execBroadcast(
    accountId: string,
    broadcastId: string,
    segment: SegmentFilter,
    templateId: string,
  ): Promise<Result<BroadcastExecutionResult, AppError>> {
    try {
      // Resolve template body
      const tpl = await db
        .prepare(`SELECT type, body FROM templates WHERE id = ? AND account_id = ?`)
        .bind(templateId, accountId)
        .first<{ type: string; body: string }>();

      if (!tpl) {
        return err(createAppError("NOT_FOUND", "Template not found"));
      }

      // --- 17.2: Load account settings & timezone ---
      const accountResult = await getAccountInfo(accountId);
      if (!accountResult.ok) return accountResult;
      const { settings, timezone, healthScore } = accountResult.value;

      // --- 17.3: Health score guardrail ---
      if (healthScore === "danger") {
        return err(
          createAppError("HEALTH_DANGER", "アカウントヘルスがdangerのため配信を抑止しました"),
        );
      }

      // --- 17.3: Weekly broadcast limit (null = unlimited) ---
      if (settings.weekly_broadcast_limit !== null && settings.weekly_broadcast_limit > 0) {
        const weeklyCountResult = await getWeeklyBroadcastCount(accountId);
        if (!weeklyCountResult.ok) return weeklyCountResult;
        if (weeklyCountResult.value >= settings.weekly_broadcast_limit) {
          return err(
            createAppError(
              "BROADCAST_LIMIT_EXCEEDED",
              `週次配信上限（${settings.weekly_broadcast_limit}回）に到達しています`,
            ),
          );
        }
      }

      // --- 17.2: Delivery window time check ---
      const currentHour = getCurrentHourInTimezone(now(), timezone);
      const inWindow = isWithinDeliveryWindow(
        currentHour,
        settings.delivery_window_start,
        settings.delivery_window_end,
      );

      const usersResult = await querySegmentImpl(accountId, segment);
      if (!usersResult.ok) return usersResult;

      const users = usersResult.value;

      // If outside delivery window, skip all users
      if (!inWindow) {
        const totalSkipped = users.length;
        await db
          .prepare(
            `UPDATE broadcasts SET sent_count = 0, skipped_count = ?, total_recipients = ?, status = 'completed', completed_at = ? WHERE id = ?`,
          )
          .bind(totalSkipped, totalSkipped, now(), broadcastId)
          .run();
        return ok({ sent: 0, skipped: totalSkipped, failed: 0 });
      }

      const userIds = users.map((u) => u.id);
      const windowSet = await getActiveWindowUserIds(accountId, userIds);

      let sent = 0;
      let skipped = 0;

      for (const user of users) {
        // 17.2: Window filter
        if (!windowSet.has(user.id)) {
          skipped++;
          continue;
        }

        // 17.3: No-response skip
        if (settings.no_response_skip_threshold > 0) {
          const noResponse = await isNoResponseUser(
            accountId,
            user.id,
            settings.no_response_skip_threshold,
          );
          if (noResponse) {
            skipped++;
            continue;
          }
        }

        const msgId = generateId();
        await sendQueue.send({
          id: msgId,
          accountId,
          igUserId: user.id,
          recipientId: user.ig_scoped_id,
          messagePayload: tpl.body,
          mediaCategory: tpl.type === "text" ? "text" : "image",
          sourceType: "broadcast",
          sourceId: broadcastId,
          enrollmentId: null,
          retryCount: 0,
        });
        sent++;
      }

      // Update broadcast record
      await db
        .prepare(
          `UPDATE broadcasts SET sent_count = ?, skipped_count = ?, total_recipients = ?, status = 'completed', completed_at = ? WHERE id = ?`,
        )
        .bind(sent, skipped, sent + skipped, now(), broadcastId)
        .run();

      return ok({ sent, skipped, failed: 0 });
    } catch (e) {
      return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Broadcast execution failed"));
    }
  }
}
