import type { Result } from "@gramstep/shared";
import type { AppError, CreateTrackedLinkInput, LinkClickAction } from "@gramstep/shared";
import type { TrackedLink } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface TrackedLinkView {
  id: string;
  account_id: string;
  original_url: string;
  short_code: string;
  source_type: string;
  source_id: string | null;
  click_actions: LinkClickAction[];
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface LinkClickView {
  id: string;
  tracked_link_id: string;
  account_id: string;
  ig_user_id: string | null;
  clicked_at: number;
}

export interface LinkAnalytics {
  total_clicks: number;
  unique_users: number;
}

export interface LinkTrackerService {
  createLink(accountId: string, input: CreateTrackedLinkInput): Promise<Result<TrackedLinkView, AppError>>;
  getByShortCode(shortCode: string): Promise<Result<TrackedLinkView, AppError>>;
  recordClick(linkId: string, accountId: string, igUserId: string | null): Promise<Result<LinkClickView, AppError>>;
  listLinks(accountId: string, limit?: number): Promise<Result<TrackedLinkView[], AppError>>;
  getLinkAnalytics(linkId: string, accountId: string): Promise<Result<LinkAnalytics, AppError>>;
  deleteLink(linkId: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface LinkTrackerDeps {
  db: D1Database;
  now: () => number;
}

function generateShortCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

function parseClickActions(raw: string | null): LinkClickAction[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LinkClickAction[];
  } catch {
    return [];
  }
}

function toLinkView(row: TrackedLink): TrackedLinkView {
  return {
    id: row.id,
    account_id: row.account_id,
    original_url: row.original_url,
    short_code: row.short_code,
    source_type: row.source_type,
    source_id: row.source_id,
    click_actions: parseClickActions(row.click_actions),
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createLinkTracker(deps: LinkTrackerDeps): LinkTrackerService {
  const { db, now } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    createLink: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const shortCode = generateShortCode();
        const timestamp = now();
        const actionsJson = JSON.stringify(input.click_actions);

        await db
          .prepare(
            `INSERT INTO tracked_links (id, account_id, original_url, short_code, source_type, source_id, click_actions, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, accountId, input.original_url, shortCode, input.source_type, input.source_id ?? null, actionsJson, timestamp, timestamp)
          .run();

        return ok({
          id,
          account_id: accountId,
          original_url: input.original_url,
          short_code: shortCode,
          source_type: input.source_type,
          source_id: input.source_id ?? null,
          click_actions: input.click_actions,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }),

    getByShortCode: (shortCode) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM tracked_links WHERE short_code = ? AND is_active = 1`)
          .bind(shortCode)
          .first<TrackedLink>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "リンクが見つかりません"));
        }
        return ok(toLinkView(row));
      }),

    recordClick: (linkId, accountId, igUserId) =>
      wrapD1(async () => {
        const id = generateId();
        const timestamp = now();

        await db
          .prepare(
            `INSERT INTO link_clicks (id, tracked_link_id, account_id, ig_user_id, clicked_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(id, linkId, accountId, igUserId, timestamp)
          .run();

        return ok({
          id,
          tracked_link_id: linkId,
          account_id: accountId,
          ig_user_id: igUserId,
          clicked_at: timestamp,
        });
      }),

    listLinks: (accountId, limit = 50) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM tracked_links WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`)
          .bind(accountId, limit)
          .all<TrackedLink>();
        return ok(result.results.map(toLinkView));
      }),

    getLinkAnalytics: (linkId, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(
            `SELECT
              COUNT(*) AS total_clicks,
              COUNT(DISTINCT ig_user_id) AS unique_users
            FROM link_clicks
            WHERE tracked_link_id = ? AND account_id = ?`,
          )
          .bind(linkId, accountId)
          .first<{ total_clicks: number; unique_users: number }>();

        return ok({
          total_clicks: row?.total_clicks ?? 0,
          unique_users: row?.unique_users ?? 0,
        });
      }),

    deleteLink: (linkId, accountId) =>
      wrapD1(async () => {
        const timestamp = now();
        await db
          .prepare(`UPDATE tracked_links SET is_active = 0, updated_at = ? WHERE id = ? AND account_id = ?`)
          .bind(timestamp, linkId, accountId)
          .run();
        return ok(undefined);
      }),
  };
}
