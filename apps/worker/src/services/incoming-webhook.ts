import type { Result } from "@gramstep/shared";
import type { AppError, CreateIncomingWebhookInput, UpdateIncomingWebhookInput, IncomingWebhookAction } from "@gramstep/shared";
import type { IncomingWebhook } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface IncomingWebhookView {
  id: string;
  account_id: string;
  name: string;
  actions: IncomingWebhookAction[];
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface IncomingWebhookProcessResult {
  actions_executed: number;
  errors: string[];
}

export interface IncomingWebhookService {
  create(accountId: string, input: CreateIncomingWebhookInput): Promise<Result<IncomingWebhookView, AppError>>;
  list(accountId: string): Promise<Result<IncomingWebhookView[], AppError>>;
  get(id: string, accountId: string): Promise<Result<IncomingWebhookView, AppError>>;
  update(id: string, accountId: string, input: UpdateIncomingWebhookInput): Promise<Result<IncomingWebhookView, AppError>>;
  delete(id: string, accountId: string): Promise<Result<void, AppError>>;
  processEvent(webhookId: string, igScopedId: string, data: Record<string, unknown>): Promise<Result<IncomingWebhookProcessResult, AppError>>;
  verifySignature(secret: string, timestamp: string, nonce: string, body: string, signature: string): Promise<boolean>;
}

export interface IncomingWebhookDeps {
  db: D1Database;
  now: () => number;
}

function toView(row: IncomingWebhook): IncomingWebhookView {
  let actions: IncomingWebhookAction[] = [];
  try {
    actions = JSON.parse(row.actions) as IncomingWebhookAction[];
  } catch {
    actions = [];
  }
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    actions,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createIncomingWebhookService(deps: IncomingWebhookDeps): IncomingWebhookService {
  const { db, now } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    create: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const secret = generateSecret();
        const timestamp = now();
        const actionsJson = JSON.stringify(input.actions);

        await db
          .prepare(
            `INSERT INTO incoming_webhooks (id, account_id, name, secret, actions, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, accountId, input.name, secret, actionsJson, timestamp, timestamp)
          .run();

        return ok({
          id,
          account_id: accountId,
          name: input.name,
          actions: input.actions,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }),

    list: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM incoming_webhooks WHERE account_id = ? ORDER BY created_at DESC`)
          .bind(accountId)
          .all<IncomingWebhook>();
        return ok(result.results.map(toView));
      }),

    get: (id, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM incoming_webhooks WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<IncomingWebhook>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "Incoming webhookが見つかりません"));
        }
        return ok(toView(row));
      }),

    update: (id, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM incoming_webhooks WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<IncomingWebhook>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "Incoming webhookが見つかりません"));
        }

        const updated = {
          name: input.name ?? existing.name,
          actions: input.actions ? JSON.stringify(input.actions) : existing.actions,
          is_active: input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        };
        const timestamp = now();

        await db
          .prepare(
            `UPDATE incoming_webhooks SET name = ?, actions = ?, is_active = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
          )
          .bind(updated.name, updated.actions, updated.is_active, timestamp, id, accountId)
          .run();

        return ok(toView({ ...existing, ...updated, updated_at: timestamp }));
      }),

    delete: (id, accountId) =>
      wrapD1(async () => {
        await db
          .prepare(`DELETE FROM incoming_webhooks WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .run();
        return ok(undefined);
      }),

    processEvent: (webhookId, igScopedId, data) =>
      wrapD1(async () => {
        const wh = await db
          .prepare(`SELECT * FROM incoming_webhooks WHERE id = ? AND is_active = 1`)
          .bind(webhookId)
          .first<IncomingWebhook>();
        if (!wh) {
          return err(createAppError("NOT_FOUND", "Incoming webhookが見つかりません"));
        }

        // Find ig_user by ig_scoped_id
        const igUser = await db
          .prepare(`SELECT id FROM ig_users WHERE ig_scoped_id = ? AND account_id = ?`)
          .bind(igScopedId, wh.account_id)
          .first<{ id: string }>();
        if (!igUser) {
          return err(createAppError("NOT_FOUND", "ユーザーが見つかりません"));
        }

        let actions: IncomingWebhookAction[] = [];
        try {
          actions = JSON.parse(wh.actions) as IncomingWebhookAction[];
        } catch {
          actions = [];
        }

        let actionsExecuted = 0;
        const errors: string[] = [];
        const timestamp = now();

        for (const action of actions) {
          try {
            switch (action.type) {
              case "add_tag": {
                // Find or create tag, then link to user
                let tag = await db
                  .prepare(`SELECT id FROM tags WHERE name = ? AND account_id = ?`)
                  .bind(action.tag_name, wh.account_id)
                  .first<{ id: string }>();
                if (!tag) {
                  const tagId = generateId();
                  await db
                    .prepare(`INSERT INTO tags (id, account_id, name, created_at) VALUES (?, ?, ?, ?)`)
                    .bind(tagId, wh.account_id, action.tag_name, timestamp)
                    .run();
                  tag = { id: tagId };
                }
                await db
                  .prepare(`INSERT OR IGNORE INTO ig_user_tags (ig_user_id, tag_id, created_at) VALUES (?, ?, ?)`)
                  .bind(igUser.id, tag.id, timestamp)
                  .run();
                actionsExecuted++;
                break;
              }
              case "remove_tag": {
                const tag = await db
                  .prepare(`SELECT id FROM tags WHERE name = ? AND account_id = ?`)
                  .bind(action.tag_name, wh.account_id)
                  .first<{ id: string }>();
                if (tag) {
                  await db
                    .prepare(`DELETE FROM ig_user_tags WHERE ig_user_id = ? AND tag_id = ?`)
                    .bind(igUser.id, tag.id)
                    .run();
                }
                actionsExecuted++;
                break;
              }
              case "enroll_scenario": {
                const enrollId = generateId();
                await db
                  .prepare(
                    `INSERT OR IGNORE INTO scenario_enrollments (id, scenario_id, ig_user_id, account_id, current_step_order, status, started_at)
                     VALUES (?, ?, ?, ?, 0, 'active', ?)`,
                  )
                  .bind(enrollId, action.scenario_id, igUser.id, wh.account_id, timestamp)
                  .run();
                actionsExecuted++;
                break;
              }
              case "update_metadata": {
                const currentMeta = await db
                  .prepare(`SELECT metadata FROM ig_users WHERE id = ?`)
                  .bind(igUser.id)
                  .first<{ metadata: string }>();
                let meta: Record<string, unknown> = {};
                try {
                  meta = JSON.parse(currentMeta?.metadata ?? "{}") as Record<string, unknown>;
                } catch {
                  meta = {};
                }
                meta[action.key] = action.value;
                await db
                  .prepare(`UPDATE ig_users SET metadata = ?, updated_at = ? WHERE id = ?`)
                  .bind(JSON.stringify(meta), timestamp, igUser.id)
                  .run();
                actionsExecuted++;
                break;
              }
              case "update_score": {
                await db
                  .prepare(`UPDATE ig_users SET score = score + ?, updated_at = ? WHERE id = ?`)
                  .bind(action.delta, timestamp, igUser.id)
                  .run();
                actionsExecuted++;
                break;
              }
              case "record_cv": {
                const cvId = generateId();
                const cvValue = action.value ?? 0;
                await db
                  .prepare(
                    `INSERT INTO conversion_events (id, account_id, conversion_point_id, ig_user_id, value, metadata, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  )
                  .bind(cvId, wh.account_id, action.conversion_point_id, igUser.id, cvValue, data ? JSON.stringify(data) : null, timestamp)
                  .run();
                actionsExecuted++;
                break;
              }
            }
          } catch (e) {
            errors.push(`${action.type}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        return ok({ actions_executed: actionsExecuted, errors });
      }),

    verifySignature: async (secret, timestamp, nonce, body, signature) => {
      const currentTime = now();
      const ts = parseInt(timestamp, 10);
      if (isNaN(ts) || Math.abs(currentTime - ts) > 300) {
        return false;
      }

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const message = `${timestamp}.${nonce}.${body}`;
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
      const expected = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return expected === signature;
    },
  };
}
