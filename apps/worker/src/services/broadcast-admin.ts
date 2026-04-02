import { generateId } from "@gramstep/db";
import type { Broadcast as BroadcastRow, IgUser } from "@gramstep/db";
import type { AccountSettings, AppError, Result, SegmentFilter } from "@gramstep/shared";
import { AccountSettingsSchema, createAppError, err, ok } from "@gramstep/shared";
import { createBroadcastEngine } from "./broadcast-engine.js";

export type BroadcastSaveMode = "draft" | "publish";

export interface BroadcastAdminView {
  id: string;
  name: string;
  template_id: string;
  template_name: string | null;
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

export interface BroadcastRecipientPreviewItem {
  id: string;
  ig_username: string | null;
  display_name: string | null;
  follower_status: string;
}

export interface BroadcastRecipientPreviewResult {
  total_matched: number;
  total_recipients: number;
  excluded_no_window: number;
  excluded_no_response: number;
  page: number;
  limit: number;
  users: BroadcastRecipientPreviewItem[];
}

export interface BroadcastWriteInput {
  name: string;
  template_id: string;
  segment: SegmentFilter;
  scheduled_at: number | null;
  save_mode?: BroadcastSaveMode;
}

export interface BroadcastUpdateInput {
  name?: string;
  template_id?: string;
  segment?: SegmentFilter;
  scheduled_at?: number | null;
  save_mode?: BroadcastSaveMode;
}

export interface BroadcastAdminDeps {
  db: D1Database;
  sendQueue: Queue<import("@gramstep/shared").SendQueueMessage>;
  now: () => number;
}

interface JoinedBroadcastRow extends BroadcastRow {
  template_name: string | null;
}

interface CandidateUser {
  id: string;
  ig_scoped_id: string;
  account_id: string;
}

interface AccountInfo {
  settings: AccountSettings;
}

const STANDALONE_BROADCAST_FROM = `
  FROM broadcasts b
  LEFT JOIN templates t ON t.id = b.template_id AND t.account_id = b.account_id
  LEFT JOIN campaigns c ON c.id = b.id
`;

const STANDALONE_BROADCAST_WHERE = "WHERE c.id IS NULL";

function normalizeSegment(segment: SegmentFilter | null | undefined): SegmentFilter {
  return {
    logic: segment?.logic ?? "and",
    conditions: segment?.conditions ?? [],
  };
}

function parseSegment(segmentRaw: string): SegmentFilter {
  try {
    return normalizeSegment(JSON.parse(segmentRaw) as SegmentFilter);
  } catch {
    return normalizeSegment(null);
  }
}

function toAdminView(row: JoinedBroadcastRow): BroadcastAdminView {
  return {
    id: row.id,
    name: row.name,
    template_id: row.template_id,
    template_name: row.template_name,
    segment: parseSegment(row.segment),
    status: row.status,
    scheduled_at: row.scheduled_at,
    total_recipients: row.total_recipients,
    sent_count: row.sent_count,
    skipped_count: row.skipped_count,
    failed_count: row.failed_count,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function resolveStatus(saveMode: BroadcastSaveMode, scheduledAt: number | null, now: number): string {
  if (saveMode === "draft") return "draft";
  if (scheduledAt !== null && scheduledAt > now) return "scheduled";
  return "sending";
}

function isEditableStatus(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

function isDeletableStatus(status: string): boolean {
  return status === "draft" || status === "scheduled" || status === "cancelled" || status === "completed";
}

export function createBroadcastAdminService(deps: BroadcastAdminDeps) {
  const engine = createBroadcastEngine(deps);

  async function getAccountInfo(accountId: string): Promise<Result<AccountInfo, AppError>> {
    try {
      const row = await deps.db
        .prepare("SELECT settings FROM accounts WHERE id = ?")
        .bind(accountId)
        .first<{ settings: string | null }>();
      if (!row) {
        return err(createAppError("NOT_FOUND", "アカウントが見つかりません"));
      }
      const parsed = AccountSettingsSchema.safeParse(row.settings ? JSON.parse(row.settings) : {});
      return ok({
        settings: parsed.success ? parsed.data : AccountSettingsSchema.parse({}),
      });
    } catch (error) {
      return err(createAppError("D1_ERROR", error instanceof Error ? error.message : "Account lookup failed"));
    }
  }

  async function isNoResponseUser(accountId: string, igUserId: string, threshold: number): Promise<boolean> {
    if (threshold <= 0) return false;
    try {
      const row = await deps.db
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
      return (row?.count ?? 0) >= threshold;
    } catch {
      return false;
    }
  }

  async function getActiveWindowUserIds(accountId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const placeholders = userIds.map(() => "?").join(",");
    const result = await deps.db
      .prepare(
        `SELECT ig_user_id FROM messaging_windows
         WHERE account_id = ? AND ig_user_id IN (${placeholders}) AND is_active = 1 AND window_expires_at > ?`,
      )
      .bind(accountId, ...userIds, deps.now())
      .all<{ ig_user_id: string }>();
    return new Set((result.results ?? []).map((row) => row.ig_user_id));
  }

  async function loadStandaloneBroadcast(id: string, accountId: string): Promise<BroadcastAdminView | null> {
    const row = await deps.db
      .prepare(
        `SELECT b.*, t.name AS template_name
         ${STANDALONE_BROADCAST_FROM}
         ${STANDALONE_BROADCAST_WHERE} AND b.id = ? AND b.account_id = ?`,
      )
      .bind(id, accountId)
      .first<JoinedBroadcastRow>();

    return row ? toAdminView(row) : null;
  }

  async function ensureTemplateExists(templateId: string, accountId: string): Promise<Result<void, AppError>> {
    const template = await deps.db
      .prepare("SELECT id FROM templates WHERE id = ? AND account_id = ?")
      .bind(templateId, accountId)
      .first<{ id: string }>();

    if (!template) {
      return err(createAppError("NOT_FOUND", "パッケージが見つかりません"));
    }
    return ok(undefined);
  }

  async function executeImmediate(
    accountId: string,
    broadcastId: string,
    segment: SegmentFilter,
    templateId: string,
  ): Promise<Result<BroadcastAdminView, AppError>> {
    const result = await engine.executeBroadcast(accountId, broadcastId, segment, templateId);
    if (!result.ok) {
      await deps.db
        .prepare("UPDATE broadcasts SET status = 'draft' WHERE id = ? AND account_id = ?")
        .bind(broadcastId, accountId)
        .run()
        .catch(() => undefined);
      return err(result.error);
    }

    const refreshed = await loadStandaloneBroadcast(broadcastId, accountId);
    if (!refreshed) {
      return err(createAppError("NOT_FOUND", "Broadcast not found after execution"));
    }
    return ok(refreshed);
  }

  async function buildRecipientPreview(
    accountId: string,
    segment: SegmentFilter,
    page: number,
    limit: number,
  ): Promise<Result<BroadcastRecipientPreviewResult, AppError>> {
    const normalizedSegment = normalizeSegment(segment);
    const usersResult = await engine.querySegment(accountId, normalizedSegment);
    if (!usersResult.ok) {
      return err(usersResult.error);
    }

    const candidates = usersResult.value as CandidateUser[];
    const accountResult = await getAccountInfo(accountId);
    if (!accountResult.ok) {
      return err(accountResult.error);
    }

    const settings = accountResult.value.settings;
    const activeWindowUserIds = await getActiveWindowUserIds(
      accountId,
      candidates.map((candidate) => candidate.id),
    );

    const readyUserIds: string[] = [];
    let excludedNoWindow = 0;
    let excludedNoResponse = 0;

    for (const candidate of candidates) {
      if (!activeWindowUserIds.has(candidate.id)) {
        excludedNoWindow += 1;
        continue;
      }

      if (settings.no_response_skip_threshold > 0) {
        const skipped = await isNoResponseUser(accountId, candidate.id, settings.no_response_skip_threshold);
        if (skipped) {
          excludedNoResponse += 1;
          continue;
        }
      }

      readyUserIds.push(candidate.id);
    }

    const offset = (page - 1) * limit;
    const pageUserIds = readyUserIds.slice(offset, offset + limit);
    if (pageUserIds.length === 0) {
      return ok({
        total_matched: candidates.length,
        total_recipients: readyUserIds.length,
        excluded_no_window: excludedNoWindow,
        excluded_no_response: excludedNoResponse,
        page,
        limit,
        users: [],
      });
    }

    const placeholders = pageUserIds.map(() => "?").join(",");
    const detailsResult = await deps.db
      .prepare(
        `SELECT id, ig_username, display_name, follower_status
         FROM ig_users
         WHERE account_id = ? AND id IN (${placeholders})`,
      )
      .bind(accountId, ...pageUserIds)
      .all<Pick<IgUser, "id" | "ig_username" | "display_name" | "follower_status">>();

    const detailMap = new Map(
      (detailsResult.results ?? []).map((row) => [row.id, row]),
    );

    return ok({
      total_matched: candidates.length,
      total_recipients: readyUserIds.length,
      excluded_no_window: excludedNoWindow,
      excluded_no_response: excludedNoResponse,
      page,
      limit,
      users: pageUserIds.flatMap((userId) => {
        const row = detailMap.get(userId);
        return row
          ? [{
            id: row.id,
            ig_username: row.ig_username,
            display_name: row.display_name,
            follower_status: row.follower_status ?? "unknown",
          }]
          : [];
      }),
    });
  }

  return {
    async list(accountId: string): Promise<Result<BroadcastAdminView[], AppError>> {
      try {
        const result = await deps.db
          .prepare(
            `SELECT b.*, t.name AS template_name
             ${STANDALONE_BROADCAST_FROM}
             ${STANDALONE_BROADCAST_WHERE} AND b.account_id = ?
             ORDER BY b.created_at DESC`,
          )
          .bind(accountId)
          .all<JoinedBroadcastRow>();

        return ok((result.results ?? []).map(toAdminView));
      } catch (error) {
        return err(createAppError("D1_ERROR", error instanceof Error ? error.message : "Broadcast list failed"));
      }
    },

    async get(accountId: string, id: string): Promise<Result<BroadcastAdminView, AppError>> {
      const view = await loadStandaloneBroadcast(id, accountId);
      if (!view) {
        return err(createAppError("NOT_FOUND", "一斉配信が見つかりません"));
      }
      return ok(view);
    },

    async create(accountId: string, input: BroadcastWriteInput): Promise<Result<BroadcastAdminView, AppError>> {
      const templateResult = await ensureTemplateExists(input.template_id, accountId);
      if (!templateResult.ok) {
        return templateResult;
      }

      const now = deps.now();
      const broadcastId = generateId();
      const segment = normalizeSegment(input.segment);
      const saveMode = input.save_mode ?? "publish";
      const status = resolveStatus(saveMode, input.scheduled_at, now);

      try {
        await deps.db
          .prepare(
            `INSERT INTO broadcasts (
              id, account_id, name, template_id, segment, status, scheduled_at,
              total_recipients, sent_count, skipped_count, failed_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
          )
          .bind(
            broadcastId,
            accountId,
            input.name,
            input.template_id,
            JSON.stringify(segment),
            status,
            input.scheduled_at,
            now,
          )
          .run();

        if (status === "sending") {
          return executeImmediate(accountId, broadcastId, segment, input.template_id);
        }

        const created = await loadStandaloneBroadcast(broadcastId, accountId);
        if (!created) {
          return err(createAppError("NOT_FOUND", "一斉配信が見つかりません"));
        }
        return ok(created);
      } catch (error) {
        return err(createAppError("D1_ERROR", error instanceof Error ? error.message : "Broadcast creation failed"));
      }
    },

    async update(accountId: string, id: string, input: BroadcastUpdateInput): Promise<Result<BroadcastAdminView, AppError>> {
      const existing = await loadStandaloneBroadcast(id, accountId);
      if (!existing) {
        return err(createAppError("NOT_FOUND", "一斉配信が見つかりません"));
      }
      if (!isEditableStatus(existing.status)) {
        return err(createAppError("CONFLICT", "この一斉配信は編集できません"));
      }

      const nextTemplateId = input.template_id ?? existing.template_id;
      const templateResult = await ensureTemplateExists(nextTemplateId, accountId);
      if (!templateResult.ok) {
        return templateResult;
      }

      const nextSegment = normalizeSegment(input.segment ?? existing.segment);
      const nextScheduledAt = input.scheduled_at === undefined ? existing.scheduled_at : input.scheduled_at;
      const saveMode = input.save_mode ?? "publish";
      const nextStatus = resolveStatus(saveMode, nextScheduledAt, deps.now());

      try {
        await deps.db
          .prepare(
            `UPDATE broadcasts
             SET name = ?, template_id = ?, segment = ?, scheduled_at = ?, status = ?, completed_at = NULL
             WHERE id = ? AND account_id = ?`,
          )
          .bind(
            input.name ?? existing.name,
            nextTemplateId,
            JSON.stringify(nextSegment),
            nextScheduledAt,
            nextStatus,
            id,
            accountId,
          )
          .run();

        if (nextStatus === "sending") {
          return executeImmediate(accountId, id, nextSegment, nextTemplateId);
        }

        const updated = await loadStandaloneBroadcast(id, accountId);
        if (!updated) {
          return err(createAppError("NOT_FOUND", "一斉配信が見つかりません"));
        }
        return ok(updated);
      } catch (error) {
        return err(createAppError("D1_ERROR", error instanceof Error ? error.message : "Broadcast update failed"));
      }
    },

    async delete(accountId: string, id: string): Promise<Result<void, AppError>> {
      const existing = await loadStandaloneBroadcast(id, accountId);
      if (!existing) {
        return err(createAppError("NOT_FOUND", "一斉配信が見つかりません"));
      }
      if (!isDeletableStatus(existing.status)) {
        return err(createAppError("CONFLICT", "この一斉配信は削除できません"));
      }

      await deps.db
        .prepare("DELETE FROM broadcasts WHERE id = ? AND account_id = ?")
        .bind(id, accountId)
        .run();

      return ok(undefined);
    },

    async previewSegment(
      accountId: string,
      segment: SegmentFilter,
      page = 1,
      limit = 20,
    ): Promise<Result<BroadcastRecipientPreviewResult, AppError>> {
      return buildRecipientPreview(accountId, segment, page, limit);
    },

    async previewRecipients(
      accountId: string,
      id: string,
      page = 1,
      limit = 20,
    ): Promise<Result<BroadcastRecipientPreviewResult, AppError>> {
      const existing = await loadStandaloneBroadcast(id, accountId);
      if (!existing) {
        return err(createAppError("NOT_FOUND", "一斉配信が見つかりません"));
      }

      return buildRecipientPreview(accountId, existing.segment, page, limit);
    },

    async dispatchDueBroadcasts(): Promise<{
      processed: number;
      errors: Array<{ broadcastId: string; message: string }>;
    }> {
      const now = deps.now();
      const dueRows = await deps.db
        .prepare(
          `SELECT b.id, b.account_id, b.template_id, b.segment
           ${STANDALONE_BROADCAST_FROM}
           ${STANDALONE_BROADCAST_WHERE}
             AND b.status = 'scheduled'
             AND b.scheduled_at IS NOT NULL
             AND b.scheduled_at <= ?
           ORDER BY b.scheduled_at ASC
           LIMIT 20`,
        )
        .bind(now)
        .all<Pick<BroadcastRow, "id" | "account_id" | "template_id" | "segment">>();

      let processed = 0;
      const errors: Array<{ broadcastId: string; message: string }> = [];

      for (const row of dueRows.results ?? []) {
        const claim = await deps.db
          .prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'")
          .bind(row.id)
          .run();

        if ((claim.meta.changes ?? 0) === 0) {
          continue;
        }

        const result = await engine.executeBroadcast(
          row.account_id,
          row.id,
          parseSegment(row.segment),
          row.template_id,
        );

        if (!result.ok) {
          errors.push({ broadcastId: row.id, message: result.error.message });
          await deps.db
            .prepare("UPDATE broadcasts SET status = 'cancelled' WHERE id = ?")
            .bind(row.id)
            .run()
            .catch(() => undefined);
          continue;
        }

        processed += 1;
      }

      return { processed, errors };
    },
  };
}
