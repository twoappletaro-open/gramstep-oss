import type { Env } from "../env.js";
import type { Campaign, CampaignDispatch } from "@gramstep/db";
import { generateId } from "@gramstep/db";
import type { SendQueueMessage, SegmentCondition } from "@gramstep/shared";
import { AccountSettingsSchema, SegmentFilterSchema } from "@gramstep/shared";
import { isWindowActiveDirect } from "../services/window-manager.js";
import { syncBroadcastStatus } from "../services/campaign-engine.js";

export type CampaignTaskResult = {
  statusTransitions: number;
  materialized: number;
  enqueued: number;
  completed: number;
  errors: Array<{ campaignId: string; message: string }>;
};

export type MaterializeResult = {
  dispatched: number;
  skipped: number;
  skipReason: string | null;
};

// --- Segment query helpers (mirrored from broadcast-engine for KV-write-free path) ---

function sqlOperator(op: string): string {
  switch (op) {
    case "eq": return "=";
    case "neq": return "!=";
    case "gt": return ">";
    case "gte": return ">=";
    case "lt": return "<";
    case "lte": return "<=";
    default: return "=";
  }
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

function isWithinDeliveryWindow(currentHour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return currentHour >= start && currentHour < end;
  return currentHour >= start || currentHour < end;
}

// --- claimScheduledCampaigns ---

/**
 * scheduled_at <= now のキャンペーンをlock_tokenで排他claimし、dispatching遷移する。
 * 5分前のlock_tokenは期限切れとみなしてre-claim可能。
 */
async function claimScheduledCampaigns(
  db: D1Database,
  now: number,
): Promise<Campaign[]> {
  const lockToken = generateId();
  const leaseExpiry = now - 300; // 5分前のlock_tokenは期限切れ

  await db
    .prepare(
      `UPDATE campaigns SET lock_token = ?, locked_at = ?, status = 'dispatching', started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE status = 'scheduled' AND scheduled_at <= ?
         AND (lock_token IS NULL OR locked_at < ?)
       LIMIT 3`,
    )
    .bind(lockToken, now, now, now, now, leaseExpiry)
    .run();

  const result = await db
    .prepare(
      "SELECT * FROM campaigns WHERE lock_token = ? AND status = 'dispatching'",
    )
    .bind(lockToken)
    .all<Campaign>();

  return result.results;
}

// --- materializeDispatches ---

/**
 * claimしたキャンペーンのaudience_filterを評価し、campaign_dispatches行をINSERTする。
 * アカウントヘルス(danger拒否)、配信ウィンドウ時間帯、週次配信上限を検証。
 * isWindowActiveDirect()を使用してKV write回避。
 */
async function materializeDispatches(
  db: D1Database,
  campaign: Campaign,
  now: number,
): Promise<MaterializeResult> {
  const accountId = campaign.account_id;

  // 1. アカウント情報取得（ヘルス・設定・タイムゾーン）
  const accountRow = await db
    .prepare("SELECT settings, timezone, health_score FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ settings: string | null; timezone: string | null; health_score: string }>();

  if (!accountRow) {
    return { dispatched: 0, skipped: 0, skipReason: "account_not_found" };
  }

  // 2. ヘルスチェック: danger → 全スキップ
  if (accountRow.health_score === "danger") {
    await releaseLock(db, campaign.id);
    return { dispatched: 0, skipped: 0, skipReason: "health_danger" };
  }

  const parsed = AccountSettingsSchema.safeParse(
    accountRow.settings ? JSON.parse(accountRow.settings) : {},
  );
  const settings = parsed.success ? parsed.data : AccountSettingsSchema.parse({});

  // 3. 配信ウィンドウ時間帯チェック
  const currentHour = getCurrentHourInTimezone(now, accountRow.timezone);
  if (!isWithinDeliveryWindow(currentHour, settings.delivery_window_start, settings.delivery_window_end)) {
    await releaseLock(db, campaign.id);
    return { dispatched: 0, skipped: 0, skipReason: "outside_delivery_window" };
  }

  // 4. 週次配信上限チェック（broadcasts + campaigns統合カウント）
  if (settings.weekly_broadcast_limit !== null && settings.weekly_broadcast_limit > 0) {
    const weekAgo = now - 7 * 24 * 60 * 60;
    const weeklyCount = await db
      .prepare(
        `SELECT COUNT(*) as count FROM broadcasts WHERE account_id = ? AND status = 'completed' AND completed_at >= ?`,
      )
      .bind(accountId, weekAgo)
      .first<{ count: number }>();

    if ((weeklyCount?.count ?? 0) >= settings.weekly_broadcast_limit) {
      await releaseLock(db, campaign.id);
      return { dispatched: 0, skipped: 0, skipReason: "weekly_limit_exceeded" };
    }
  }

  // 5. テンプレート取得
  if (!campaign.message_template_id) {
    await releaseLock(db, campaign.id);
    return { dispatched: 0, skipped: 0, skipReason: "no_template" };
  }

  const template = await db
    .prepare("SELECT id, body, type FROM templates WHERE id = ? AND account_id = ?")
    .bind(campaign.message_template_id, accountId)
    .first<{ id: string; body: string; type: string }>();

  if (!template) {
    await releaseLock(db, campaign.id);
    return { dispatched: 0, skipped: 0, skipReason: "template_not_found" };
  }

  // 6. セグメントフィルタ評価 → 対象ユーザー取得
  let users: Array<{ id: string; ig_scoped_id: string; account_id: string }>;

  if (campaign.audience_filter) {
    const filterParsed = SegmentFilterSchema.safeParse(JSON.parse(campaign.audience_filter));
    if (!filterParsed.success) {
      await releaseLock(db, campaign.id);
      return { dispatched: 0, skipped: 0, skipReason: "invalid_audience_filter" };
    }
    const filter = filterParsed.data;
    const { where, bindings, joins } = buildSegmentWhere(filter.conditions, filter.logic);
    const joinClause = joins.join(" ");
    const result = await db
      .prepare(
        `SELECT DISTINCT u.id, u.ig_scoped_id, u.account_id FROM ig_users u ${joinClause} WHERE u.account_id = ? AND u.is_opted_out = 0 AND u.is_deleted = 0 AND u.is_blocked = 0 AND (${where})`,
      )
      .bind(accountId, ...bindings)
      .all<{ id: string; ig_scoped_id: string; account_id: string }>();
    users = result.results;
  } else {
    // フィルタなし: 全アクティブユーザー
    const result = await db
      .prepare(
        "SELECT id, ig_scoped_id, account_id FROM ig_users WHERE account_id = ? AND is_opted_out = 0 AND is_deleted = 0 AND is_blocked = 0",
      )
      .bind(accountId)
      .all<{ id: string; ig_scoped_id: string; account_id: string }>();
    users = result.results;
  }

  // 7. 各ユーザーに対してisWindowActiveDirect()でウィンドウ確認 → dispatch INSERT
  let dispatched = 0;
  let skipped = 0;

  for (const user of users) {
    const windowActive = await isWindowActiveDirect(db, accountId, user.id);
    if (!windowActive) {
      // ウィンドウなし → skipped dispatch
      const dispatchId = generateId();
      await db
        .prepare(
          `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, skip_reason, created_at)
           VALUES (?, ?, ?, ?, ?, 'broadcast', 'dm', ?, 'skipped', 'no_window', ?)
           ON CONFLICT(campaign_id, ig_user_id, dispatch_kind) DO NOTHING`,
        )
        .bind(dispatchId, campaign.id, accountId, user.id, user.ig_scoped_id, template.body, now)
        .run();
      skipped++;
      continue;
    }

    const dispatchId = generateId();
    await db
      .prepare(
        `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'broadcast', 'dm', ?, 'pending', ?)
         ON CONFLICT(campaign_id, ig_user_id, dispatch_kind) DO NOTHING`,
      )
      .bind(dispatchId, campaign.id, accountId, user.id, user.ig_scoped_id, template.body, now)
      .run();
    dispatched++;
  }

  // 8. lock解放（enqueueはleased-outboxステップ4で処理）
  await releaseLock(db, campaign.id);

  return { dispatched, skipped, skipReason: null };
}

async function releaseLock(db: D1Database, campaignId: string): Promise<void> {
  await db
    .prepare(
      "UPDATE campaigns SET lock_token = NULL, locked_at = NULL WHERE id = ?",
    )
    .bind(campaignId)
    .run();
}

/**
 * 後日抽選: randomメソッドの自動抽選実行。
 * drawing + random → pending応募者からランダム選出 → entries更新 → dispatches一括作成 → dispatching遷移
 */
async function executeRandomDraw(
  db: D1Database,
  campaign: Campaign,
  now: number,
): Promise<void> {
  const winnerLimit = campaign.winner_limit ?? 0;

  // 1. pending応募者からランダム選出
  const winners = await db
    .prepare(
      `SELECT id, ig_user_id FROM campaign_entries
       WHERE campaign_id = ? AND result = 'pending'
       ORDER BY RANDOM() LIMIT ?`,
    )
    .bind(campaign.id, winnerLimit)
    .all<{ id: string; ig_user_id: string }>();

  const winnerIds = new Set(winners.results.map((w) => w.id));

  // 2. 全pending応募者を取得して結果を更新
  const allPending = await db
    .prepare(
      `SELECT id, ig_user_id FROM campaign_entries
       WHERE campaign_id = ? AND result = 'pending'`,
    )
    .bind(campaign.id)
    .all<{ id: string; ig_user_id: string }>();

  for (const entry of allPending.results) {
    const isWinner = winnerIds.has(entry.id);
    await db
      .prepare(
        "UPDATE campaign_entries SET result = ?, result_reason = 'random', selected_at = ? WHERE id = ? AND result = 'pending'",
      )
      .bind(isWinner ? "win" : "lose", now, entry.id)
      .run();
  }

  // 3. 当選/落選テンプレート取得
  const winnerTemplate = campaign.winner_template_id
    ? await db
        .prepare("SELECT id, body, type FROM templates WHERE id = ?")
        .bind(campaign.winner_template_id)
        .first<{ id: string; body: string; type: string }>()
    : null;

  const loserTemplate = campaign.loser_template_id
    ? await db
        .prepare("SELECT id, body, type FROM templates WHERE id = ?")
        .bind(campaign.loser_template_id)
        .first<{ id: string; body: string; type: string }>()
    : null;

  // 4. dispatches一括作成（ウィンドウ切れ前提: 送信時にdelivery-engineがskipped判定）
  for (const entry of allPending.results) {
    const isWinner = winnerIds.has(entry.id);
    const template = isWinner ? winnerTemplate : loserTemplate;
    if (!template) continue;

    const dispatchKind = isWinner ? "winner" : "loser";

    // ig_scoped_id（recipientId）を取得
    const user = await db
      .prepare("SELECT ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ?")
      .bind(entry.ig_user_id, campaign.account_id)
      .first<{ ig_scoped_id: string }>();
    if (!user) continue;

    const dispatchId = generateId();
    await db
      .prepare(
        `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'dm', ?, 'pending', ?)
         ON CONFLICT(campaign_id, ig_user_id, dispatch_kind) DO NOTHING`,
      )
      .bind(dispatchId, campaign.id, campaign.account_id, entry.ig_user_id, user.ig_scoped_id, dispatchKind, template.body, now)
      .run();
  }

  // 5. ステータス遷移: drawing → dispatching + lock解放
  await db
    .prepare(
      "UPDATE campaigns SET status = 'dispatching', lock_token = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(now, campaign.id)
    .run();
}

/**
 * Phase 1 leased-outbox骨格 + Phase 2 materialize処理:
 * (1) ステータス遷移(instant_win終了/deferred_lottery drawing)
 * (2) random抽選（Phase 4で接続）
 * (3) 予約配信のclaim + materialize
 * (4) pending→queued enqueue
 * (5) 完了判定
 */
export async function handleCampaignTasks(
  env: Env,
): Promise<CampaignTaskResult> {
  const now = Math.floor(Date.now() / 1000);
  const db = env.DB;
  const DISPATCH_LIMIT_PER_RUN = 100;
  let statusTransitions = 0;
  let materialized = 0;
  let enqueued = 0;
  let completed = 0;
  const errors: CampaignTaskResult["errors"] = [];

  // --- 1. ステータス遷移 ---

  // 1a. instant_win: entry_end_at超過 → completed
  const instantWinResult = await db
    .prepare(
      `UPDATE campaigns SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE kind = 'instant_win' AND status = 'active' AND entry_end_at <= ?`,
    )
    .bind(now, now, now)
    .run();
  statusTransitions += instantWinResult.meta?.changes ?? 0;

  // 1b. deferred_lottery: entry_end_at超過 → drawing
  const deferredResult = await db
    .prepare(
      `UPDATE campaigns SET status = 'drawing', updated_at = ?
       WHERE kind = 'deferred_lottery' AND status = 'active' AND entry_end_at <= ?`,
    )
    .bind(now, now)
    .run();
  statusTransitions += deferredResult.meta?.changes ?? 0;

  // --- 2. random抽選の自動実行（Phase 4で接続、骨格のみ） ---
  const drawLock = generateId();
  const drawLeaseExpiry = now - 300; // 5分前のlock_tokenは期限切れ
  await db
    .prepare(
      `UPDATE campaigns SET lock_token = ?, locked_at = ?, updated_at = ?
       WHERE status = 'drawing' AND selection_method = 'random'
         AND (lock_token IS NULL OR locked_at < ?)
       LIMIT 3`,
    )
    .bind(drawLock, now, now, drawLeaseExpiry)
    .run();
  const drawingCampaigns = await db
    .prepare(
      "SELECT * FROM campaigns WHERE lock_token = ? AND status = 'drawing'",
    )
    .bind(drawLock)
    .all<Campaign>();
  for (const c of drawingCampaigns.results) {
    try {
      await executeRandomDraw(db, c, now);
      statusTransitions++;
    } catch (e) {
      await releaseLock(db, c.id);
      errors.push({
        campaignId: c.id,
        message: `Random draw failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // --- 3. 予約配信のclaim + materialize ---
  try {
    const scheduledCampaigns = await claimScheduledCampaigns(db, now);
    for (const c of scheduledCampaigns) {
      try {
        const result = await materializeDispatches(db, c, now);
        materialized += result.dispatched;
        if (result.skipReason) {
          errors.push({
            campaignId: c.id,
            message: `Materialize skipped: ${result.skipReason}`,
          });
        }
      } catch (e) {
        await releaseLock(db, c.id);
        errors.push({
          campaignId: c.id,
          message: `Materialize failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  } catch (e) {
    errors.push({
      campaignId: "claim",
      message: `claimScheduledCampaigns failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // --- 4. pending dispatchesのenqueue（leased-outboxパターン） ---
  const dailyBudget = await getRemainingQueueBudget(db, now);
  const perRunLimit = Math.min(DISPATCH_LIMIT_PER_RUN, Math.floor(dailyBudget / 3));

  if (perRunLimit > 0) {
    const accounts = await db
      .prepare(
        `SELECT DISTINCT account_id FROM campaign_dispatches
         WHERE status = 'pending' AND channel = 'dm'
         LIMIT 10`,
      )
      .all<{ account_id: string }>();

    for (const acct of accounts.results) {
      try {
        // 1. pending行のIDを先に取得（LIMIT付き）
        const pendingRows = await db
          .prepare(
            `SELECT id FROM campaign_dispatches
             WHERE status = 'pending' AND channel = 'dm' AND account_id = ?
             LIMIT ?`,
          )
          .bind(acct.account_id, perRunLimit)
          .all<{ id: string }>();

        if (pendingRows.results.length === 0) continue;

        const ids = pendingRows.results.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");

        // 2. 原子的にpending→queued（IDで特定するため二重enqueue防止）
        await db
          .prepare(
            `UPDATE campaign_dispatches
             SET status = 'queued', queued_at = ?
             WHERE id IN (${placeholders}) AND status = 'pending'`,
          )
          .bind(now, ...ids)
          .run();

        // 3. queued化された行を取得してenqueue
        const claimed = await db
          .prepare(
            `SELECT * FROM campaign_dispatches
             WHERE id IN (${placeholders}) AND status = 'queued'`,
          )
          .bind(...ids)
          .all<CampaignDispatch>();

        for (const d of claimed.results) {
          const queueMsg: SendQueueMessage = {
            id: generateId(),
            accountId: d.account_id,
            igUserId: d.ig_user_id,
            recipientId: d.recipient_id,
            messagePayload: d.message_payload,
            mediaCategory: "text",
            sourceType: "campaign",
            sourceId: d.campaign_id,
            enrollmentId: null,
            retryCount: 0,
            dispatchId: d.id,
          };
          await env.SEND_QUEUE.send(queueMsg);
          enqueued++;
        }
      } catch (e) {
        errors.push({
          campaignId: acct.account_id,
          message: `Enqueue failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  // --- 5. キャンペーン完了判定 ---
  completed = await checkCampaignCompletion(db, now);

  return { statusTransitions, materialized, enqueued, completed, errors };
}

/**
 * 日次Queue ops残予算を算出。
 * Queue ops = write + read + ack = 3 ops/メッセージ。
 * デフォルト日次上限: 2,500通 (= 7,500 ops)
 */
async function getRemainingQueueBudget(
  db: D1Database,
  now: number,
): Promise<number> {
  const DAILY_DISPATCH_LIMIT = 2500;
  const startOfDay = now - (now % 86400); // UTC midnight

  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM campaign_dispatches
       WHERE queued_at >= ? AND status IN ('queued', 'sent', 'failed')`,
    )
    .bind(startOfDay)
    .first<{ count: number }>();

  const usedToday = row?.count ?? 0;
  return Math.max(0, DAILY_DISPATCH_LIMIT - usedToday);
}

/**
 * dispatchingキャンペーンの完了判定:
 * 全dispatchesがsent/skipped/failed/cancelledなら completed に遷移
 */
async function checkCampaignCompletion(
  db: D1Database,
  now: number,
): Promise<number> {
  // dispatching状態のキャンペーンで、pendingまたはqueuedのdispatchが残っていないもの
  const candidates = await db
    .prepare(
      `SELECT c.id FROM campaigns c
       WHERE c.status = 'dispatching'
         AND NOT EXISTS (
           SELECT 1 FROM campaign_dispatches d
           WHERE d.campaign_id = c.id AND d.status IN ('pending', 'queued')
         )`,
    )
    .all<{ id: string }>();

  let completedCount = 0;
  for (const c of candidates.results) {
    const result = await db
      .prepare(
        "UPDATE campaigns SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'dispatching'",
      )
      .bind(now, now, c.id)
      .run();
    const changed = result.meta?.changes ?? 0;
    if (changed > 0) {
      // Broadcasts互換: scheduled_dmキャンペーンのbroadcastsレコードを同期
      // kindの判定はcampaignsテーブルから取得せず、broadcastsにIDが存在する場合のみ更新
      await syncBroadcastStatus(db, c.id, "completed", now);
    }
    completedCount += changed;
  }
  return completedCount;
}
