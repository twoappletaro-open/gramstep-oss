import type { Result } from "@gramstep/shared";
import type { AppError, CreateOutgoingWebhookInput, UpdateOutgoingWebhookInput, OutgoingWebhookEventType } from "@gramstep/shared";
import type { OutgoingWebhook, OutgoingWebhookLog } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface OutgoingWebhookView {
  id: string;
  account_id: string;
  name: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface OutgoingWebhookLogView {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string;
  status_code: number | null;
  success: boolean;
  attempted_at: number;
}

export interface EventBusEmitResult {
  dispatched: number;
  succeeded: number;
  failed: number;
}

export interface EventBusService {
  createWebhook(accountId: string, input: CreateOutgoingWebhookInput): Promise<Result<OutgoingWebhookView, AppError>>;
  listWebhooks(accountId: string): Promise<Result<OutgoingWebhookView[], AppError>>;
  getWebhook(webhookId: string, accountId: string): Promise<Result<OutgoingWebhookView, AppError>>;
  updateWebhook(webhookId: string, accountId: string, input: UpdateOutgoingWebhookInput): Promise<Result<OutgoingWebhookView, AppError>>;
  deleteWebhook(webhookId: string, accountId: string): Promise<Result<void, AppError>>;
  emit(accountId: string, eventType: OutgoingWebhookEventType, payload: Record<string, unknown>): Promise<Result<EventBusEmitResult, AppError>>;
  listLogs(webhookId: string, accountId: string, limit?: number): Promise<Result<OutgoingWebhookLogView[], AppError>>;
}

export interface EventBusDeps {
  db: D1Database;
  now: () => number;
  fetchImpl?: typeof fetch;
}

function toView(row: OutgoingWebhook): OutgoingWebhookView {
  let eventTypes: string[] = [];
  try {
    eventTypes = JSON.parse(row.event_types) as string[];
  } catch {
    eventTypes = [];
  }
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    url: row.url,
    event_types: eventTypes,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function signPayload(secret: string, timestamp: number, nonce: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = `${timestamp}.${nonce}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createEventBus(deps: EventBusDeps): EventBusService {
  const { db, now, fetchImpl } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    createWebhook: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const secret = generateNonce() + generateNonce();
        const timestamp = now();
        const eventTypesJson = JSON.stringify(input.event_types);

        await db
          .prepare(
            `INSERT INTO outgoing_webhooks (id, account_id, name, url, secret, event_types, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, accountId, input.name, input.url, secret, eventTypesJson, timestamp, timestamp)
          .run();

        return ok({
          id,
          account_id: accountId,
          name: input.name,
          url: input.url,
          event_types: input.event_types,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }),

    listWebhooks: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM outgoing_webhooks WHERE account_id = ? ORDER BY created_at DESC`)
          .bind(accountId)
          .all<OutgoingWebhook>();
        return ok(result.results.map(toView));
      }),

    getWebhook: (webhookId, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM outgoing_webhooks WHERE id = ? AND account_id = ?`)
          .bind(webhookId, accountId)
          .first<OutgoingWebhook>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "Outgoing webhookが見つかりません"));
        }
        return ok(toView(row));
      }),

    updateWebhook: (webhookId, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM outgoing_webhooks WHERE id = ? AND account_id = ?`)
          .bind(webhookId, accountId)
          .first<OutgoingWebhook>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "Outgoing webhookが見つかりません"));
        }

        const updated = {
          name: input.name ?? existing.name,
          url: input.url ?? existing.url,
          event_types: input.event_types ? JSON.stringify(input.event_types) : existing.event_types,
          is_active: input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        };
        const timestamp = now();

        await db
          .prepare(
            `UPDATE outgoing_webhooks SET name = ?, url = ?, event_types = ?, is_active = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
          )
          .bind(updated.name, updated.url, updated.event_types, updated.is_active, timestamp, webhookId, accountId)
          .run();

        return ok(toView({ ...existing, ...updated, updated_at: timestamp }));
      }),

    deleteWebhook: (webhookId, accountId) =>
      wrapD1(async () => {
        await db
          .prepare(`DELETE FROM outgoing_webhooks WHERE id = ? AND account_id = ?`)
          .bind(webhookId, accountId)
          .run();
        return ok(undefined);
      }),

    emit: (accountId, eventType, payload) =>
      wrapD1(async () => {
        const webhooks = await db
          .prepare(
            `SELECT * FROM outgoing_webhooks WHERE account_id = ? AND is_active = 1`,
          )
          .bind(accountId)
          .all<OutgoingWebhook>();

        const matching = webhooks.results.filter((wh) => {
          let types: string[] = [];
          try {
            types = JSON.parse(wh.event_types) as string[];
          } catch {
            types = [];
          }
          return types.includes(eventType);
        });

        let succeeded = 0;
        let failed = 0;
        const fetcher = fetchImpl ?? fetch;

        for (const wh of matching) {
          const timestamp = now();
          const nonce = generateNonce();
          const bodyStr = JSON.stringify({ event_type: eventType, data: payload, timestamp, nonce });
          const signature = await signPayload(wh.secret, timestamp, nonce, bodyStr);

          let statusCode: number | null = null;
          let responseBody: string | null = null;
          let success = false;

          try {
            const resp = await fetcher(wh.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Signature-256": signature,
                "X-Timestamp": String(timestamp),
                "X-Nonce": nonce,
              },
              body: bodyStr,
            });
            statusCode = resp.status;
            responseBody = await resp.text().catch(() => null);
            success = resp.ok;
          } catch {
            success = false;
          }

          if (success) {
            succeeded++;
          } else {
            failed++;
          }

          const logId = generateId();
          await db
            .prepare(
              `INSERT INTO outgoing_webhook_logs (id, webhook_id, event_type, payload, status_code, response_body, success, attempted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(logId, wh.id, eventType, bodyStr, statusCode, responseBody, success ? 1 : 0, timestamp)
            .run();
        }

        return ok({ dispatched: matching.length, succeeded, failed });
      }),

    listLogs: (webhookId, accountId, limit = 50) =>
      wrapD1(async () => {
        // Verify ownership
        const wh = await db
          .prepare(`SELECT id FROM outgoing_webhooks WHERE id = ? AND account_id = ?`)
          .bind(webhookId, accountId)
          .first<{ id: string }>();
        if (!wh) {
          return err(createAppError("NOT_FOUND", "Outgoing webhookが見つかりません"));
        }

        const result = await db
          .prepare(
            `SELECT * FROM outgoing_webhook_logs WHERE webhook_id = ? ORDER BY attempted_at DESC LIMIT ?`,
          )
          .bind(webhookId, limit)
          .all<OutgoingWebhookLog>();

        return ok(
          result.results.map((r) => ({
            id: r.id,
            webhook_id: r.webhook_id,
            event_type: r.event_type,
            payload: r.payload,
            status_code: r.status_code,
            success: r.success === 1,
            attempted_at: r.attempted_at,
          })),
        );
      }),
  };
}
