import type { Result } from "@gramstep/shared";
import type { AppError, CreateConversionPointInput, UpdateConversionPointInput, RecordConversionEventInput } from "@gramstep/shared";
import type { ConversionPoint, ConversionEvent } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface ConversionPointView {
  id: string;
  account_id: string;
  name: string;
  type: string;
  value: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface ConversionEventView {
  id: string;
  account_id: string;
  conversion_point_id: string;
  ig_user_id: string | null;
  scenario_id: string | null;
  value: number;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export interface ConversionReport {
  conversion_point_id: string;
  conversion_point_name: string;
  total_events: number;
  total_value: number;
  unique_users: number;
}

export interface CVTrackerService {
  createPoint(accountId: string, input: CreateConversionPointInput): Promise<Result<ConversionPointView, AppError>>;
  listPoints(accountId: string): Promise<Result<ConversionPointView[], AppError>>;
  getPoint(pointId: string, accountId: string): Promise<Result<ConversionPointView, AppError>>;
  updatePoint(pointId: string, accountId: string, input: UpdateConversionPointInput): Promise<Result<ConversionPointView, AppError>>;
  deletePoint(pointId: string, accountId: string): Promise<Result<void, AppError>>;
  recordEvent(accountId: string, input: RecordConversionEventInput): Promise<Result<ConversionEventView, AppError>>;
  listEvents(accountId: string, pointId?: string, igUserId?: string, scenarioId?: string, limit?: number): Promise<Result<ConversionEventView[], AppError>>;
  getReport(accountId: string, scenarioId?: string): Promise<Result<ConversionReport[], AppError>>;
}

export interface CVTrackerDeps {
  db: D1Database;
  now: () => number;
}

function toPointView(row: ConversionPoint): ConversionPointView {
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    type: row.type,
    value: row.value,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toEventView(row: ConversionEvent): ConversionEventView {
  let metadata: Record<string, unknown> | null = null;
  try {
    if (row.metadata) {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    }
  } catch {
    metadata = null;
  }
  return {
    id: row.id,
    account_id: row.account_id,
    conversion_point_id: row.conversion_point_id,
    ig_user_id: row.ig_user_id,
    scenario_id: row.scenario_id,
    value: row.value,
    metadata,
    created_at: row.created_at,
  };
}

export function createCVTracker(deps: CVTrackerDeps): CVTrackerService {
  const { db, now } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    createPoint: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const timestamp = now();

        await db
          .prepare(
            `INSERT INTO conversion_points (id, account_id, name, type, value, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, accountId, input.name, input.type, input.value, timestamp, timestamp)
          .run();

        return ok({
          id,
          account_id: accountId,
          name: input.name,
          type: input.type,
          value: input.value,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }),

    listPoints: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM conversion_points WHERE account_id = ? ORDER BY created_at DESC`)
          .bind(accountId)
          .all<ConversionPoint>();
        return ok(result.results.map(toPointView));
      }),

    getPoint: (pointId, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM conversion_points WHERE id = ? AND account_id = ?`)
          .bind(pointId, accountId)
          .first<ConversionPoint>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "コンバージョンポイントが見つかりません"));
        }
        return ok(toPointView(row));
      }),

    updatePoint: (pointId, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM conversion_points WHERE id = ? AND account_id = ?`)
          .bind(pointId, accountId)
          .first<ConversionPoint>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "コンバージョンポイントが見つかりません"));
        }

        const updated = {
          name: input.name ?? existing.name,
          type: input.type ?? existing.type,
          value: input.value !== undefined ? input.value : existing.value,
          is_active: input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        };
        const timestamp = now();

        await db
          .prepare(
            `UPDATE conversion_points SET name = ?, type = ?, value = ?, is_active = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
          )
          .bind(updated.name, updated.type, updated.value, updated.is_active, timestamp, pointId, accountId)
          .run();

        return ok(toPointView({ ...existing, ...updated, updated_at: timestamp }));
      }),

    deletePoint: (pointId, accountId) =>
      wrapD1(async () => {
        await db
          .prepare(`DELETE FROM conversion_points WHERE id = ? AND account_id = ?`)
          .bind(pointId, accountId)
          .run();
        return ok(undefined);
      }),

    recordEvent: (accountId, input) =>
      wrapD1(async () => {
        // Verify conversion point exists
        const point = await db
          .prepare(`SELECT * FROM conversion_points WHERE id = ? AND account_id = ? AND is_active = 1`)
          .bind(input.conversion_point_id, accountId)
          .first<ConversionPoint>();
        if (!point) {
          return err(createAppError("NOT_FOUND", "コンバージョンポイントが見つかりません"));
        }

        const id = generateId();
        const eventValue = input.value ?? point.value;
        const timestamp = now();
        const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

        await db
          .prepare(
            `INSERT INTO conversion_events (id, account_id, conversion_point_id, ig_user_id, scenario_id, value, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, accountId, input.conversion_point_id, input.ig_user_id ?? null, input.scenario_id ?? null, eventValue, metadataJson, timestamp)
          .run();

        return ok({
          id,
          account_id: accountId,
          conversion_point_id: input.conversion_point_id,
          ig_user_id: input.ig_user_id ?? null,
          scenario_id: input.scenario_id ?? null,
          value: eventValue,
          metadata: input.metadata ?? null,
          created_at: timestamp,
        });
      }),

    listEvents: (accountId, pointId, igUserId, scenarioId, limit = 50) =>
      wrapD1(async () => {
        let query = `SELECT * FROM conversion_events WHERE account_id = ?`;
        const bindings: unknown[] = [accountId];

        if (pointId) {
          query += ` AND conversion_point_id = ?`;
          bindings.push(pointId);
        }
        if (igUserId) {
          query += ` AND ig_user_id = ?`;
          bindings.push(igUserId);
        }
        if (scenarioId) {
          query += ` AND scenario_id = ?`;
          bindings.push(scenarioId);
        }

        query += ` ORDER BY created_at DESC LIMIT ?`;
        bindings.push(limit);

        const result = await db
          .prepare(query)
          .bind(...bindings)
          .all<ConversionEvent>();

        return ok(result.results.map(toEventView));
      }),

    getReport: (accountId, scenarioId) =>
      wrapD1(async () => {
        let query = `
          SELECT
            cp.id AS conversion_point_id,
            cp.name AS conversion_point_name,
            COUNT(ce.id) AS total_events,
            COALESCE(SUM(ce.value), 0) AS total_value,
            COUNT(DISTINCT ce.ig_user_id) AS unique_users
          FROM conversion_points cp
          LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id AND ce.account_id = ?
        `;
        const bindings: unknown[] = [accountId];

        if (scenarioId) {
          query += ` AND ce.scenario_id = ?`;
          bindings.push(scenarioId);
        }

        query += ` WHERE cp.account_id = ? GROUP BY cp.id ORDER BY total_events DESC`;
        bindings.push(accountId);

        const result = await db
          .prepare(query)
          .bind(...bindings)
          .all<{
            conversion_point_id: string;
            conversion_point_name: string;
            total_events: number;
            total_value: number;
            unique_users: number;
          }>();

        return ok(
          result.results.map((r) => ({
            conversion_point_id: r.conversion_point_id,
            conversion_point_name: r.conversion_point_name,
            total_events: r.total_events,
            total_value: r.total_value,
            unique_users: r.unique_users,
          })),
        );
      }),
  };
}
