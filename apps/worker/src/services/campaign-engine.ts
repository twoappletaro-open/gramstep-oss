import type { Result } from "@gramstep/shared";
import type {
  AppError,
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignKind,
  CampaignStatus,
} from "@gramstep/shared";
import type { Campaign } from "@gramstep/db";
import { ok, err, createAppError, CreateCampaignInputSchema, UpdateCampaignInputSchema } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

// --- View types ---

export interface CampaignView {
  id: string;
  account_id: string;
  kind: CampaignKind;
  name: string;
  status: CampaignStatus;
  audience_filter: unknown | null;
  message_template_id: string | null;
  scheduled_at: number | null;
  entry_start_at: number | null;
  entry_end_at: number | null;
  selection_method: string | null;
  win_probability: number | null;
  winner_limit: number | null;
  remaining_winner_slots: number | null;
  winner_template_id: string | null;
  loser_template_id: string | null;
  winner_actions: unknown[];
  loser_actions: unknown[];
  entry_confirm_enabled: boolean;
  entry_confirm_template_id: string | null;
  duplicate_action: string;
  version: number;
  started_at: number | null;
  completed_at: number | null;
  paused_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface CampaignDetailView extends CampaignView {
  entries_summary: {
    total: number;
    pending: number;
    win: number;
    lose: number;
    duplicate: number;
    ineligible: number;
  };
  dispatches_summary: {
    total: number;
    pending: number;
    queued: number;
    sent: number;
    skipped: number;
    failed: number;
    cancelled: number;
  };
}

export interface CampaignListResult {
  campaigns: CampaignView[];
  total: number;
}

// --- Service interface ---

export interface CampaignEngineService {
  create(accountId: string, input: CreateCampaignInput): Promise<Result<CampaignView, AppError>>;
  get(accountId: string, campaignId: string): Promise<Result<CampaignDetailView, AppError>>;
  list(accountId: string, options: ListOptions): Promise<Result<CampaignListResult, AppError>>;
  update(accountId: string, campaignId: string, input: UpdateCampaignInput): Promise<Result<CampaignView, AppError>>;
  remove(accountId: string, campaignId: string): Promise<Result<void, AppError>>;
  cancel(accountId: string, campaignId: string, version: number): Promise<Result<CampaignView, AppError>>;
  resume(accountId: string, campaignId: string, version: number): Promise<Result<CampaignView, AppError>>;
}

export interface ListOptions {
  kind?: CampaignKind;
  status?: CampaignStatus;
  limit?: number;
  offset?: number;
}

export interface CampaignEngineDeps {
  db: D1Database;
  now: () => number;
}

// --- Helpers ---

function toView(row: Campaign): CampaignView {
  return {
    id: row.id,
    account_id: row.account_id,
    kind: row.kind as CampaignKind,
    name: row.name,
    status: row.status as CampaignStatus,
    audience_filter: row.audience_filter ? JSON.parse(row.audience_filter) : null,
    message_template_id: row.message_template_id,
    scheduled_at: row.scheduled_at,
    entry_start_at: row.entry_start_at,
    entry_end_at: row.entry_end_at,
    selection_method: row.selection_method,
    win_probability: row.win_probability,
    winner_limit: row.winner_limit,
    remaining_winner_slots: row.remaining_winner_slots,
    winner_template_id: row.winner_template_id,
    loser_template_id: row.loser_template_id,
    winner_actions: JSON.parse(row.winner_actions),
    loser_actions: JSON.parse(row.loser_actions),
    entry_confirm_enabled: row.entry_confirm_enabled === 1,
    entry_confirm_template_id: row.entry_confirm_template_id,
    duplicate_action: row.duplicate_action,
    version: row.version,
    started_at: row.started_at,
    completed_at: row.completed_at,
    paused_reason: row.paused_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Statuses that allow editing */
const EDITABLE_STATUSES = new Set<string>(["draft", "scheduled"]);

/** Statuses that allow cancellation */
const CANCELLABLE_STATUSES = new Set<string>(["draft", "scheduled", "active", "drawing", "selection_pending", "dispatching", "paused"]);

/** Statuses that allow deletion */
const DELETABLE_STATUSES = new Set<string>(["draft", "cancelled"]);

/** Status transitions by kind */
const INITIAL_STATUS: Record<string, string> = {
  scheduled_dm: "draft",
  instant_win: "draft",
  deferred_lottery: "draft",
};

// --- Broadcasts dual-write helpers ---

/** Status mapping: campaigns → broadcasts */
const CAMPAIGN_TO_BROADCAST_STATUS: Record<string, string> = {
  scheduled: "scheduled",
  dispatching: "sending",
  completed: "completed",
  cancelled: "cancelled",
};

/**
 * broadcasts互換レコードの状態を同期する。
 * scheduled_dmキャンペーンのみ対象（それ以外は何もしない）。
 */
export async function syncBroadcastStatus(
  db: D1Database,
  campaignId: string,
  campaignStatus: string,
  now: number,
): Promise<void> {
  const broadcastStatus = CAMPAIGN_TO_BROADCAST_STATUS[campaignStatus];
  if (!broadcastStatus) return;

  if (campaignStatus === "completed") {
    await db
      .prepare(
        "UPDATE broadcasts SET status = 'completed', completed_at = ? WHERE id = ?",
      )
      .bind(now, campaignId)
      .run();
  } else if (campaignStatus === "cancelled") {
    await db
      .prepare("UPDATE broadcasts SET status = 'cancelled' WHERE id = ?")
      .bind(campaignId)
      .run();
  } else {
    await db
      .prepare("UPDATE broadcasts SET status = ? WHERE id = ?")
      .bind(broadcastStatus, campaignId)
      .run();
  }
}

// --- Factory ---

export function createCampaignEngine(deps: CampaignEngineDeps): CampaignEngineService {
  const { db, now } = deps;

  async function fetchCampaign(accountId: string, campaignId: string): Promise<Result<Campaign, AppError>> {
    try {
      const row = await db
        .prepare("SELECT * FROM campaigns WHERE id = ? AND account_id = ?")
        .bind(campaignId, accountId)
        .first<Campaign>();
      if (!row) {
        return err(createAppError("NOT_FOUND", "Campaign not found"));
      }
      return ok(row);
    } catch (e) {
      return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Failed to fetch campaign"));
    }
  }

  return {
    create: async (accountId, input) => {
      const parsed = CreateCampaignInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(createAppError("VALIDATION_ERROR", parsed.error.message));
      }
      const data = parsed.data;

      try {
        const id = generateId();
        const ts = now();
        const status = INITIAL_STATUS[data.kind] ?? "draft";

        const remainingWinnerSlots =
          data.kind === "instant_win" && data.winner_limit !== null
            ? data.winner_limit
            : null;

        await db
          .prepare(
            `INSERT INTO campaigns (
              id, account_id, kind, name, status,
              audience_filter, message_template_id, scheduled_at,
              entry_start_at, entry_end_at, selection_method,
              win_probability, winner_limit, remaining_winner_slots,
              winner_template_id, loser_template_id,
              winner_actions, loser_actions,
              entry_confirm_enabled, entry_confirm_template_id,
              duplicate_action, version, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?,
              ?, ?,
              ?, ?,
              ?, ?,
              ?, 1, ?, ?
            )`,
          )
          .bind(
            id, accountId, data.kind, data.name, status,
            data.audience_filter ? JSON.stringify(data.audience_filter) : null,
            data.message_template_id, data.scheduled_at,
            data.entry_start_at, data.entry_end_at, data.selection_method,
            data.win_probability, data.winner_limit, remainingWinnerSlots,
            data.winner_template_id, data.loser_template_id,
            JSON.stringify(data.winner_actions), JSON.stringify(data.loser_actions),
            data.entry_confirm_enabled ? 1 : 0, data.entry_confirm_template_id,
            data.duplicate_action, ts, ts,
          )
          .run();

        // Broadcasts互換dual-write: scheduled_dmの場合はbroadcastsにもINSERT
        if (data.kind === "scheduled_dm") {
          await db
            .prepare(
              `INSERT INTO broadcasts (id, account_id, name, template_id, segment, status, scheduled_at, total_recipients, sent_count, skipped_count, failed_count, created_at)
               VALUES (?, ?, ?, ?, ?, 'scheduled', ?, 0, 0, 0, 0, ?)`,
            )
            .bind(
              id,
              accountId,
              data.name,
              data.message_template_id ?? "",
              data.audience_filter ? JSON.stringify(data.audience_filter) : "{}",
              data.scheduled_at,
              ts,
            )
            .run();
        }

        const row = await db
          .prepare("SELECT * FROM campaigns WHERE id = ?")
          .bind(id)
          .first<Campaign>();

        if (!row) {
          return err(createAppError("D1_ERROR", "Failed to read created campaign"));
        }

        return ok(toView(row));
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Campaign creation failed"));
      }
    },

    get: async (accountId, campaignId) => {
      const campaignResult = await fetchCampaign(accountId, campaignId);
      if (!campaignResult.ok) return campaignResult;
      const row = campaignResult.value;

      try {
        const entriesAgg = await db
          .prepare(
            `SELECT result, COUNT(*) as count FROM campaign_entries
             WHERE campaign_id = ? GROUP BY result`,
          )
          .bind(campaignId)
          .all<{ result: string; count: number }>();

        const dispatchesAgg = await db
          .prepare(
            `SELECT status, COUNT(*) as count FROM campaign_dispatches
             WHERE campaign_id = ? GROUP BY status`,
          )
          .bind(campaignId)
          .all<{ status: string; count: number }>();

        const entriesSummary = { total: 0, pending: 0, win: 0, lose: 0, duplicate: 0, ineligible: 0 };
        for (const r of entriesAgg.results) {
          const key = r.result as keyof typeof entriesSummary;
          if (key in entriesSummary && key !== "total") {
            entriesSummary[key] = r.count;
          }
          entriesSummary.total += r.count;
        }

        const dispatchesSummary = { total: 0, pending: 0, queued: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0 };
        for (const r of dispatchesAgg.results) {
          const key = r.status as keyof typeof dispatchesSummary;
          if (key in dispatchesSummary && key !== "total") {
            dispatchesSummary[key] = r.count;
          }
          dispatchesSummary.total += r.count;
        }

        const view = toView(row);
        return ok({
          ...view,
          entries_summary: entriesSummary,
          dispatches_summary: dispatchesSummary,
        });
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Failed to fetch campaign details"));
      }
    },

    list: async (accountId, options) => {
      try {
        const conditions: string[] = ["account_id = ?"];
        const bindings: unknown[] = [accountId];

        if (options.kind) {
          conditions.push("kind = ?");
          bindings.push(options.kind);
        }
        if (options.status) {
          conditions.push("status = ?");
          bindings.push(options.status);
        }

        const where = conditions.join(" AND ");
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
        const offset = Math.max(options.offset ?? 0, 0);

        const countResult = await db
          .prepare(`SELECT COUNT(*) as count FROM campaigns WHERE ${where}`)
          .bind(...bindings)
          .first<{ count: number }>();

        const rows = await db
          .prepare(
            `SELECT * FROM campaigns WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .bind(...bindings, limit, offset)
          .all<Campaign>();

        return ok({
          campaigns: rows.results.map(toView),
          total: countResult?.count ?? 0,
        });
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Failed to list campaigns"));
      }
    },

    update: async (accountId, campaignId, input) => {
      const parsed = UpdateCampaignInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(createAppError("VALIDATION_ERROR", parsed.error.message));
      }
      const data = parsed.data;

      const campaignResult = await fetchCampaign(accountId, campaignId);
      if (!campaignResult.ok) return campaignResult;
      const existing = campaignResult.value;

      // Version check
      if (existing.version !== data.version) {
        return err(
          createAppError("CONFLICT", "Version conflict: campaign has been modified", {
            expected: data.version,
            actual: existing.version,
          }),
        );
      }

      // Status-based edit restrictions
      // active instant_win: win_probabilityのみ変更可
      const isActiveInstantWin = existing.status === "active" && existing.kind === "instant_win";
      if (!EDITABLE_STATUSES.has(existing.status) && !isActiveInstantWin) {
        return err(
          createAppError("CONFLICT", `Cannot edit campaign in '${existing.status}' status`),
        );
      }

      if (isActiveInstantWin) {
        // active instant_win: win_probability以外の変更を禁止
        const forbiddenFields: Array<keyof typeof data> = [
          "name", "audience_filter", "message_template_id",
          "scheduled_at", "entry_start_at", "entry_end_at",
          "selection_method", "winner_limit",
          "winner_template_id", "loser_template_id",
          "winner_actions", "loser_actions",
          "entry_confirm_enabled", "entry_confirm_template_id",
          "duplicate_action",
        ];
        for (const field of forbiddenFields) {
          if (data[field] !== undefined) {
            return err(
              createAppError("CONFLICT", `Cannot change ${field} while instant_win campaign is active. Only win_probability can be updated.`),
            );
          }
        }
      }

      try {
        const ts = now();
        const setClauses: string[] = ["version = version + 1", "updated_at = ?"];
        const updateBindings: unknown[] = [ts];

        // Build dynamic SET clause from provided fields
        const updatableFields: Array<{ key: keyof typeof data; column: string; transform?: (v: unknown) => unknown }> = [
          { key: "name", column: "name" },
          { key: "audience_filter", column: "audience_filter", transform: (v) => v ? JSON.stringify(v) : null },
          { key: "message_template_id", column: "message_template_id" },
          { key: "scheduled_at", column: "scheduled_at" },
          { key: "entry_start_at", column: "entry_start_at" },
          { key: "entry_end_at", column: "entry_end_at" },
          { key: "selection_method", column: "selection_method" },
          { key: "win_probability", column: "win_probability" },
          { key: "winner_limit", column: "winner_limit" },
          { key: "winner_template_id", column: "winner_template_id" },
          { key: "loser_template_id", column: "loser_template_id" },
          { key: "winner_actions", column: "winner_actions", transform: (v) => JSON.stringify(v) },
          { key: "loser_actions", column: "loser_actions", transform: (v) => JSON.stringify(v) },
          { key: "entry_confirm_enabled", column: "entry_confirm_enabled", transform: (v) => v ? 1 : 0 },
          { key: "entry_confirm_template_id", column: "entry_confirm_template_id" },
          { key: "duplicate_action", column: "duplicate_action" },
        ];

        for (const field of updatableFields) {
          if (data[field.key] !== undefined) {
            setClauses.push(`${field.column} = ?`);
            const value = data[field.key];
            updateBindings.push(field.transform ? field.transform(value) : value);
          }
        }

        // Update remaining_winner_slots if winner_limit changed for instant_win
        if (
          existing.kind === "instant_win" &&
          data.winner_limit !== undefined &&
          data.winner_limit !== existing.winner_limit
        ) {
          const used = (existing.winner_limit ?? 0) - (existing.remaining_winner_slots ?? 0);
          const newRemaining = Math.max(0, (data.winner_limit ?? 0) - used);
          setClauses.push("remaining_winner_slots = ?");
          updateBindings.push(newRemaining);
        }

        updateBindings.push(data.version, campaignId, accountId);

        const result = await db
          .prepare(
            `UPDATE campaigns SET ${setClauses.join(", ")} WHERE version = ? AND id = ? AND account_id = ?`,
          )
          .bind(...updateBindings)
          .run();

        if ((result.meta?.changes ?? 0) === 0) {
          return err(createAppError("CONFLICT", "Version conflict: campaign has been modified"));
        }

        const updated = await db
          .prepare("SELECT * FROM campaigns WHERE id = ?")
          .bind(campaignId)
          .first<Campaign>();

        if (!updated) {
          return err(createAppError("D1_ERROR", "Failed to read updated campaign"));
        }

        return ok(toView(updated));
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Campaign update failed"));
      }
    },

    remove: async (accountId, campaignId) => {
      const campaignResult = await fetchCampaign(accountId, campaignId);
      if (!campaignResult.ok) return campaignResult;
      const existing = campaignResult.value;

      if (!DELETABLE_STATUSES.has(existing.status)) {
        return err(
          createAppError("CONFLICT", `Cannot delete campaign in '${existing.status}' status. Only draft or cancelled campaigns can be deleted.`),
        );
      }

      try {
        // Delete related records first
        await db
          .prepare("DELETE FROM campaign_dispatches WHERE campaign_id = ?")
          .bind(campaignId)
          .run();
        await db
          .prepare("DELETE FROM campaign_entries WHERE campaign_id = ?")
          .bind(campaignId)
          .run();
        // Broadcasts互換: scheduled_dmの場合はbroadcastsレコードも削除
        if (existing.kind === "scheduled_dm") {
          await db
            .prepare("DELETE FROM broadcasts WHERE id = ?")
            .bind(campaignId)
            .run();
        }
        await db
          .prepare("DELETE FROM campaigns WHERE id = ? AND account_id = ?")
          .bind(campaignId, accountId)
          .run();

        return ok(undefined);
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Campaign deletion failed"));
      }
    },

    cancel: async (accountId, campaignId, version) => {
      const campaignResult = await fetchCampaign(accountId, campaignId);
      if (!campaignResult.ok) return campaignResult;
      const existing = campaignResult.value;

      if (!CANCELLABLE_STATUSES.has(existing.status)) {
        return err(
          createAppError("CONFLICT", `Cannot cancel campaign in '${existing.status}' status`),
        );
      }

      if (existing.version !== version) {
        return err(
          createAppError("CONFLICT", "Version conflict: campaign has been modified", {
            expected: version,
            actual: existing.version,
          }),
        );
      }

      try {
        const ts = now();

        // Cancel campaign with version check
        const result = await db
          .prepare(
            `UPDATE campaigns SET status = 'cancelled', version = version + 1, completed_at = ?, updated_at = ?
             WHERE id = ? AND account_id = ? AND version = ?`,
          )
          .bind(ts, ts, campaignId, accountId, version)
          .run();

        if ((result.meta?.changes ?? 0) === 0) {
          return err(createAppError("CONFLICT", "Version conflict: campaign has been modified"));
        }

        // Cancel all pending/queued dispatches
        await db
          .prepare(
            `UPDATE campaign_dispatches SET status = 'cancelled', error_message = 'Campaign cancelled'
             WHERE campaign_id = ? AND status IN ('pending', 'queued')`,
          )
          .bind(campaignId)
          .run();

        // Broadcasts互換: scheduled_dmの場合はbroadcasts側も同期
        if (existing.kind === "scheduled_dm") {
          await syncBroadcastStatus(db, campaignId, "cancelled", ts);
        }

        const updated = await db
          .prepare("SELECT * FROM campaigns WHERE id = ?")
          .bind(campaignId)
          .first<Campaign>();

        if (!updated) {
          return err(createAppError("D1_ERROR", "Failed to read cancelled campaign"));
        }

        return ok(toView(updated));
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Campaign cancellation failed"));
      }
    },

    resume: async (accountId, campaignId, version) => {
      const campaignResult = await fetchCampaign(accountId, campaignId);
      if (!campaignResult.ok) return campaignResult;
      const existing = campaignResult.value;

      if (existing.status !== "paused") {
        return err(
          createAppError("CONFLICT", `Cannot resume campaign in '${existing.status}' status. Only paused campaigns can be resumed.`),
        );
      }

      if (existing.version !== version) {
        return err(
          createAppError("CONFLICT", "Version conflict: campaign has been modified", {
            expected: version,
            actual: existing.version,
          }),
        );
      }

      // Determine the target status based on kind
      let targetStatus: string;
      switch (existing.kind) {
        case "instant_win":
        case "deferred_lottery":
          targetStatus = "active";
          break;
        case "scheduled_dm":
          targetStatus = "dispatching";
          break;
        default:
          targetStatus = "active";
      }

      try {
        const ts = now();

        const result = await db
          .prepare(
            `UPDATE campaigns SET status = ?, paused_reason = NULL, version = version + 1, updated_at = ?
             WHERE id = ? AND account_id = ? AND version = ?`,
          )
          .bind(targetStatus, ts, campaignId, accountId, version)
          .run();

        if ((result.meta?.changes ?? 0) === 0) {
          return err(createAppError("CONFLICT", "Version conflict: campaign has been modified"));
        }

        const updated = await db
          .prepare("SELECT * FROM campaigns WHERE id = ?")
          .bind(campaignId)
          .first<Campaign>();

        if (!updated) {
          return err(createAppError("D1_ERROR", "Failed to read resumed campaign"));
        }

        return ok(toView(updated));
      } catch (e) {
        return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Campaign resume failed"));
      }
    },
  };
}
