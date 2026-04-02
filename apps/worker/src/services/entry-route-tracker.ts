import type { Result } from "@gramstep/shared";
import type { AppError, CreateEntryRouteInput, UpdateEntryRouteInput, EntryRouteAction } from "@gramstep/shared";
import type { EntryRoute } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface EntryRouteView {
  id: string;
  account_id: string;
  ref_code: string;
  name: string;
  actions: EntryRouteAction[];
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface EntryRouteEventView {
  id: string;
  entry_route_id: string;
  account_id: string;
  ig_user_id: string;
  ref_code: string;
  created_at: number;
}

export interface EntryRouteAnalytics {
  total_events: number;
  unique_users: number;
}

export interface EntryRouteTrackerService {
  createRoute(accountId: string, input: CreateEntryRouteInput): Promise<Result<EntryRouteView, AppError>>;
  getById(routeId: string, accountId: string): Promise<Result<EntryRouteView, AppError>>;
  getByRefCode(accountId: string, refCode: string): Promise<Result<EntryRouteView, AppError>>;
  updateRoute(routeId: string, accountId: string, input: UpdateEntryRouteInput): Promise<Result<EntryRouteView, AppError>>;
  listRoutes(accountId: string): Promise<Result<EntryRouteView[], AppError>>;
  recordEvent(routeId: string, accountId: string, igUserId: string, refCode: string): Promise<Result<EntryRouteEventView, AppError>>;
  getRouteAnalytics(routeId: string, accountId: string): Promise<Result<EntryRouteAnalytics, AppError>>;
  deleteRoute(routeId: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface EntryRouteTrackerDeps {
  db: D1Database;
  now: () => number;
}

function parseActions(raw: string): EntryRouteAction[] {
  try {
    return JSON.parse(raw) as EntryRouteAction[];
  } catch {
    return [];
  }
}

function toRouteView(row: EntryRoute): EntryRouteView {
  return {
    id: row.id,
    account_id: row.account_id,
    ref_code: row.ref_code,
    name: row.name,
    actions: parseActions(row.actions),
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createEntryRouteTracker(deps: EntryRouteTrackerDeps): EntryRouteTrackerService {
  const { db, now } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    createRoute: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const timestamp = now();
        const actionsJson = JSON.stringify(input.actions);

        await db
          .prepare(
            `INSERT INTO entry_routes (id, account_id, ref_code, name, actions, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, accountId, input.ref_code, input.name, actionsJson, timestamp, timestamp)
          .run();

        return ok({
          id,
          account_id: accountId,
          ref_code: input.ref_code,
          name: input.name,
          actions: input.actions,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }),

    getById: (routeId, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM entry_routes WHERE id = ? AND account_id = ? AND is_active = 1`)
          .bind(routeId, accountId)
          .first<EntryRoute>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "エントリールートが見つかりません"));
        }
        return ok(toRouteView(row));
      }),

    getByRefCode: (accountId, refCode) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM entry_routes WHERE account_id = ? AND ref_code = ? AND is_active = 1`)
          .bind(accountId, refCode)
          .first<EntryRoute>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "エントリールートが見つかりません"));
        }
        return ok(toRouteView(row));
      }),

    updateRoute: (routeId, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM entry_routes WHERE id = ? AND account_id = ?`)
          .bind(routeId, accountId)
          .first<EntryRoute>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "エントリールートが見つかりません"));
        }

        const updated = {
          name: input.name ?? existing.name,
          actions: input.actions ? JSON.stringify(input.actions) : existing.actions,
          is_active: input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        };
        const timestamp = now();

        await db
          .prepare(
            `UPDATE entry_routes SET name = ?, actions = ?, is_active = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
          )
          .bind(updated.name, updated.actions, updated.is_active, timestamp, routeId, accountId)
          .run();

        return ok(toRouteView({
          ...existing,
          name: updated.name,
          actions: updated.actions,
          is_active: updated.is_active,
          updated_at: timestamp,
        }));
      }),

    listRoutes: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM entry_routes WHERE account_id = ? ORDER BY created_at DESC`)
          .bind(accountId)
          .all<EntryRoute>();
        return ok(result.results.map(toRouteView));
      }),

    recordEvent: (routeId, accountId, igUserId, refCode) =>
      wrapD1(async () => {
        const id = generateId();
        const timestamp = now();

        await db
          .prepare(
            `INSERT INTO entry_route_events (id, entry_route_id, account_id, ig_user_id, ref_code, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, routeId, accountId, igUserId, refCode, timestamp)
          .run();

        return ok({
          id,
          entry_route_id: routeId,
          account_id: accountId,
          ig_user_id: igUserId,
          ref_code: refCode,
          created_at: timestamp,
        });
      }),

    getRouteAnalytics: (routeId, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(
            `SELECT
              COUNT(*) AS total_events,
              COUNT(DISTINCT ig_user_id) AS unique_users
            FROM entry_route_events
            WHERE entry_route_id = ? AND account_id = ?`,
          )
          .bind(routeId, accountId)
          .first<{ total_events: number; unique_users: number }>();

        return ok({
          total_events: row?.total_events ?? 0,
          unique_users: row?.unique_users ?? 0,
        });
      }),

    deleteRoute: (routeId, accountId) =>
      wrapD1(async () => {
        const timestamp = now();
        await db
          .prepare(`UPDATE entry_routes SET is_active = 0, updated_at = ? WHERE id = ? AND account_id = ?`)
          .bind(timestamp, routeId, accountId)
          .run();
        return ok(undefined);
      }),
  };
}
