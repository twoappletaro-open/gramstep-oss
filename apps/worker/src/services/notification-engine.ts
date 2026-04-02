import type { Result } from "@gramstep/shared";
import type { AppError, CreateNotificationRuleInput, UpdateNotificationRuleInput, NotificationEventType } from "@gramstep/shared";
import type { NotificationRule, Notification } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface NotificationRuleView {
  id: string;
  account_id: string;
  name: string;
  event_type: string;
  level: string;
  channels: string[];
  webhook_url: string | null;
  email_to: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface NotificationView {
  id: string;
  account_id: string;
  rule_id: string | null;
  event_type: string;
  level: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: number;
}

export interface EmitInput {
  event_type: NotificationEventType;
  title: string;
  body: string;
}

export interface EmitResult {
  notified: number;
  webhook_sent: number;
}

export interface NotificationEngineService {
  createRule(accountId: string, input: CreateNotificationRuleInput): Promise<Result<NotificationRuleView, AppError>>;
  listRules(accountId: string): Promise<Result<NotificationRuleView[], AppError>>;
  updateRule(ruleId: string, accountId: string, input: UpdateNotificationRuleInput): Promise<Result<NotificationRuleView, AppError>>;
  deleteRule(ruleId: string, accountId: string): Promise<Result<void, AppError>>;
  emit(accountId: string, input: EmitInput): Promise<Result<EmitResult, AppError>>;
  listNotifications(accountId: string, page?: number, perPage?: number): Promise<Result<NotificationView[], AppError>>;
  markAsRead(notificationId: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface NotificationEngineDeps {
  db: D1Database;
  now: () => number;
  fetchImpl?: typeof fetch;
}

function toRuleView(row: NotificationRule): NotificationRuleView {
  let channels: string[] = [];
  try {
    channels = JSON.parse(row.channels) as string[];
  } catch {
    channels = [];
  }
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    event_type: row.event_type,
    level: row.level,
    channels,
    webhook_url: row.webhook_url,
    email_to: row.email_to,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toNotificationView(row: Notification): NotificationView {
  return {
    id: row.id,
    account_id: row.account_id,
    rule_id: row.rule_id,
    event_type: row.event_type,
    level: row.level,
    title: row.title,
    body: row.body,
    is_read: row.is_read === 1,
    created_at: row.created_at,
  };
}

export function createNotificationEngine(deps: NotificationEngineDeps): NotificationEngineService {
  const { db, now, fetchImpl } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const fetcher = fetchImpl ?? fetch;
      const resp = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  return {
    createRule: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const timestamp = now();
        const channelsJson = JSON.stringify(input.channels);

        await db
          .prepare(
            `INSERT INTO notification_rules (id, account_id, name, event_type, level, channels, webhook_url, email_to, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            accountId,
            input.name,
            input.event_type,
            input.level,
            channelsJson,
            input.webhook_url,
            input.email_to,
            input.is_active ? 1 : 0,
            timestamp,
            timestamp,
          )
          .run();

        return ok({
          id,
          account_id: accountId,
          name: input.name,
          event_type: input.event_type,
          level: input.level,
          channels: input.channels,
          webhook_url: input.webhook_url ?? null,
          email_to: input.email_to ?? null,
          is_active: input.is_active,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }),

    listRules: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM notification_rules WHERE account_id = ? ORDER BY created_at DESC`)
          .bind(accountId)
          .all<NotificationRule>();
        return ok(result.results.map(toRuleView));
      }),

    updateRule: (ruleId, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM notification_rules WHERE id = ? AND account_id = ?`)
          .bind(ruleId, accountId)
          .first<NotificationRule>();

        if (!existing) {
          return err(createAppError("NOT_FOUND", "通知ルールが見つかりません"));
        }

        const updated = {
          name: input.name ?? existing.name,
          event_type: input.event_type ?? existing.event_type,
          level: input.level ?? existing.level,
          channels: input.channels ? JSON.stringify(input.channels) : existing.channels,
          webhook_url: input.webhook_url !== undefined ? input.webhook_url : existing.webhook_url,
          email_to: input.email_to !== undefined ? input.email_to : existing.email_to,
          is_active: input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        };

        const timestamp = now();
        await db
          .prepare(
            `UPDATE notification_rules SET name = ?, event_type = ?, level = ?, channels = ?, webhook_url = ?, email_to = ?, is_active = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(
            updated.name,
            updated.event_type,
            updated.level,
            updated.channels,
            updated.webhook_url,
            updated.email_to,
            updated.is_active,
            timestamp,
            ruleId,
          )
          .run();

        return ok(
          toRuleView({
            ...existing,
            ...updated,
            updated_at: timestamp,
          }),
        );
      }),

    deleteRule: (ruleId, accountId) =>
      wrapD1(async () => {
        await db
          .prepare(`DELETE FROM notification_rules WHERE id = ? AND account_id = ?`)
          .bind(ruleId, accountId)
          .run();
        return ok(undefined);
      }),

    emit: (accountId, input) =>
      wrapD1(async () => {
        // Find matching active rules for this event type
        const rulesResult = await db
          .prepare(
            `SELECT * FROM notification_rules WHERE account_id = ? AND event_type = ? AND is_active = 1`,
          )
          .bind(accountId, input.event_type)
          .all<NotificationRule>();

        const rules = rulesResult.results;
        let notified = 0;
        let webhookSent = 0;

        for (const rule of rules) {
          // Create dashboard notification
          const notifId = generateId();
          await db
            .prepare(
              `INSERT INTO notifications (id, account_id, rule_id, event_type, level, title, body, is_read, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            )
            .bind(notifId, accountId, rule.id, input.event_type, rule.level, input.title, input.body, now())
            .run();

          notified++;

          // Send webhook if channel includes it
          let channels: string[] = [];
          try {
            channels = JSON.parse(rule.channels) as string[];
          } catch {
            channels = [];
          }

          if (channels.includes("webhook") && rule.webhook_url) {
            const sent = await sendWebhook(rule.webhook_url, {
              event_type: input.event_type,
              level: rule.level,
              title: input.title,
              body: input.body,
              account_id: accountId,
              timestamp: now(),
            });
            if (sent) webhookSent++;
          }
        }

        return ok({ notified, webhook_sent: webhookSent });
      }),

    listNotifications: (accountId, page = 1, perPage = 20) =>
      wrapD1(async () => {
        const offset = (page - 1) * perPage;
        const result = await db
          .prepare(
            `SELECT * FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .bind(accountId, perPage, offset)
          .all<Notification>();
        return ok(result.results.map(toNotificationView));
      }),

    markAsRead: (notificationId, accountId) =>
      wrapD1(async () => {
        await db
          .prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND account_id = ?`)
          .bind(notificationId, accountId)
          .run();
        return ok(undefined);
      }),
  };
}
