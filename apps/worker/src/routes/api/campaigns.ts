import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  CreateCampaignInputSchema,
  UpdateCampaignInputSchema,
  CampaignKindSchema,
  CampaignStatusSchema,
} from "@gramstep/shared";
import { generateId } from "@gramstep/db";
import { createCampaignEngine } from "../../services/campaign-engine.js";
import type { ListOptions } from "../../services/campaign-engine.js";

export const campaignRoutes = new Hono<{ Bindings: Env }>();

function engineFrom(db: D1Database) {
  return createCampaignEngine({ db, now: () => Math.floor(Date.now() / 1000) });
}

function errorStatus(code: string): 400 | 404 | 409 | 500 {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    default:
      return 500;
  }
}

// POST /api/campaigns — 作成
campaignRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = CreateCampaignInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const engine = engineFrom(c.env.DB);
  const result = await engine.create(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message, code: result.error.code }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

// GET /api/campaigns — 一覧（kind/statusフィルタ、ページネーション）
campaignRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const url = new URL(c.req.url);

  const kindRaw = url.searchParams.get("kind");
  const statusRaw = url.searchParams.get("status");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 100);
  const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1);
  const offset = (page - 1) * limit;

  const options: ListOptions = { limit, offset };

  if (kindRaw) {
    const kindParsed = CampaignKindSchema.safeParse(kindRaw);
    if (!kindParsed.success) {
      return c.json({ error: "Invalid kind filter" }, 400);
    }
    options.kind = kindParsed.data;
  }
  if (statusRaw) {
    const statusParsed = CampaignStatusSchema.safeParse(statusRaw);
    if (!statusParsed.success) {
      return c.json({ error: "Invalid status filter" }, 400);
    }
    options.status = statusParsed.data;
  }

  const engine = engineFrom(c.env.DB);
  const result = await engine.list(accountId, options);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ data: result.value.campaigns, total: result.value.total, page, limit });
});

// GET /api/campaigns/:id — 詳細（entries/dispatches集計）
campaignRoutes.get("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");

  const engine = engineFrom(c.env.DB);
  const result = await engine.get(accountId, campaignId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// PUT /api/campaigns/:id — 更新（version楽観ロック）
campaignRoutes.put("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = UpdateCampaignInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const engine = engineFrom(c.env.DB);
  const result = await engine.update(accountId, campaignId, parsed.data);
  if (!result.ok) {
    return c.json(
      { error: result.error.message, code: result.error.code, details: result.error.details },
      errorStatus(result.error.code),
    );
  }
  return c.json(result.value);
});

// DELETE /api/campaigns/:id — 削除（draft/cancelledのみ）
campaignRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");

  const engine = engineFrom(c.env.DB);
  const result = await engine.remove(accountId, campaignId);
  if (!result.ok) {
    return c.json({ error: result.error.message, code: result.error.code }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/campaigns/:id/cancel — キャンセル（versionチェック、409 Conflict）
campaignRoutes.post("/:id/cancel", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const version = Number(body?.version);
  if (!Number.isInteger(version)) {
    return c.json({ error: "version (integer) is required" }, 400);
  }

  const engine = engineFrom(c.env.DB);
  const result = await engine.cancel(accountId, campaignId, version);
  if (!result.ok) {
    return c.json(
      { error: result.error.message, code: result.error.code, details: result.error.details },
      errorStatus(result.error.code),
    );
  }
  return c.json(result.value);
});

// GET /api/campaigns/:id/entries — 応募者一覧（ページネーション、result/ig_user_idフィルタ）
campaignRoutes.get("/:id/entries", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");
  const url = new URL(c.req.url);

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 100);
  const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1);
  const offset = (page - 1) * limit;
  const resultFilter = url.searchParams.get("result");
  const igUserIdFilter = url.searchParams.get("ig_user_id");

  // Verify campaign belongs to account
  const db = c.env.DB;
  const campaign = await db
    .prepare("SELECT id FROM campaigns WHERE id = ? AND account_id = ?")
    .bind(campaignId, accountId)
    .first<{ id: string }>();
  if (!campaign) {
    return c.json({ error: "Campaign not found" }, 404);
  }

  const conditions: string[] = ["campaign_id = ?1"];
  const bindings: unknown[] = [campaignId];
  let idx = 2;

  if (resultFilter) {
    conditions.push(`result = ?${idx}`);
    bindings.push(resultFilter);
    idx++;
  }
  if (igUserIdFilter) {
    conditions.push(`ig_user_id = ?${idx}`);
    bindings.push(igUserIdFilter);
    idx++;
  }

  const where = conditions.join(" AND ");

  const countRow = await db
    .prepare(`SELECT COUNT(*) as total FROM campaign_entries WHERE ${where}`)
    .bind(...bindings)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const rows = await db
    .prepare(
      `SELECT id, campaign_id, ig_user_id, source_trigger_id, source_comment_id,
              source_comment_created_at, result, result_reason, selected_at, created_at
       FROM campaign_entries WHERE ${where}
       ORDER BY created_at DESC LIMIT ?${idx} OFFSET ?${idx + 1}`,
    )
    .bind(...bindings, limit, offset)
    .all();

  return c.json({ data: rows.results, total, page, limit });
});

// POST /api/campaigns/:id/draw — 抽選実行（random自動選出）
campaignRoutes.post("/:id/draw", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);

  const db = c.env.DB;
  const campaign = await db
    .prepare(
      "SELECT id, status, lock_token, selection_method, winner_limit, winner_template_id, loser_template_id FROM campaigns WHERE id = ? AND account_id = ?",
    )
    .bind(campaignId, accountId)
    .first<{
      id: string;
      status: string;
      lock_token: string | null;
      selection_method: string | null;
      winner_limit: number | null;
      winner_template_id: string | null;
      loser_template_id: string | null;
    }>();

  if (!campaign) {
    return c.json({ error: "Campaign not found" }, 404);
  }
  if (campaign.status !== "drawing") {
    return c.json({ error: `Cannot draw in '${campaign.status}' status. Campaign must be in 'drawing' status.`, code: "CONFLICT" }, 409);
  }
  if (campaign.lock_token) {
    return c.json({ error: "Draw already in progress (locked)", code: "CONFLICT" }, 409);
  }

  // lock_tokenで排他制御
  const lockToken = generateId();
  const lockResult = await db
    .prepare(
      "UPDATE campaigns SET lock_token = ?, locked_at = ?, updated_at = ? WHERE id = ? AND lock_token IS NULL AND status = 'drawing'",
    )
    .bind(lockToken, now, now, campaignId)
    .run();

  if ((lockResult.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Draw already in progress (locked)", code: "CONFLICT" }, 409);
  }

  try {
    if (campaign.selection_method === "random") {
      // random: 自動選出
      const winnerLimit = campaign.winner_limit ?? 0;

      const winners = await db
        .prepare(
          "SELECT id FROM campaign_entries WHERE campaign_id = ? AND result = 'pending' ORDER BY RANDOM() LIMIT ?",
        )
        .bind(campaignId, winnerLimit)
        .all<{ id: string }>();

      const winnerIdSet = new Set(winners.results.map((w) => w.id));

      const allPending = await db
        .prepare(
          "SELECT id, ig_user_id FROM campaign_entries WHERE campaign_id = ? AND result = 'pending'",
        )
        .bind(campaignId)
        .all<{ id: string; ig_user_id: string }>();

      for (const entry of allPending.results) {
        const isWinner = winnerIdSet.has(entry.id);
        await db
          .prepare(
            "UPDATE campaign_entries SET result = ?, result_reason = 'random', selected_at = ? WHERE id = ? AND result = 'pending'",
          )
          .bind(isWinner ? "win" : "lose", now, entry.id)
          .run();
      }

      // dispatches作成
      const winnerTemplate = campaign.winner_template_id
        ? await db.prepare("SELECT body FROM templates WHERE id = ?").bind(campaign.winner_template_id).first<{ body: string }>()
        : null;
      const loserTemplate = campaign.loser_template_id
        ? await db.prepare("SELECT body FROM templates WHERE id = ?").bind(campaign.loser_template_id).first<{ body: string }>()
        : null;

      for (const entry of allPending.results) {
        const isWinner = winnerIdSet.has(entry.id);
        const template = isWinner ? winnerTemplate : loserTemplate;
        if (!template) continue;

        const user = await db
          .prepare("SELECT ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ?")
          .bind(entry.ig_user_id, accountId)
          .first<{ ig_scoped_id: string }>();
        if (!user) continue;

        const dispatchId = generateId();
        await db
          .prepare(
            `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'dm', ?, 'pending', ?)
             ON CONFLICT(campaign_id, ig_user_id, dispatch_kind) DO NOTHING`,
          )
          .bind(dispatchId, campaignId, accountId, entry.ig_user_id, user.ig_scoped_id, isWinner ? "winner" : "loser", template.body, now)
          .run();
      }

      // dispatching遷移 + lock解放
      await db
        .prepare(
          "UPDATE campaigns SET status = 'dispatching', lock_token = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(now, campaignId)
        .run();

      return c.json({ status: "dispatching", winners: winners.results.length, total: allPending.results.length });
    }

    // manual: selection_pending遷移 + lock解放
    await db
      .prepare(
        "UPDATE campaigns SET status = 'selection_pending', lock_token = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(now, campaignId)
      .run();

    return c.json({ status: "selection_pending" });
  } catch (e) {
    // D1エラー時にlock解放
    await db
      .prepare("UPDATE campaigns SET lock_token = NULL, locked_at = NULL WHERE id = ?")
      .bind(campaignId)
      .run();
    return c.json({ error: e instanceof Error ? e.message : "Draw failed", code: "D1_ERROR" }, 500);
  }
});

// POST /api/campaigns/:id/select-winners — 手動当選者選択
campaignRoutes.post("/:id/select-winners", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);

  const db = c.env.DB;
  const campaign = await db
    .prepare(
      "SELECT id, status, lock_token, winner_template_id, loser_template_id FROM campaigns WHERE id = ? AND account_id = ?",
    )
    .bind(campaignId, accountId)
    .first<{
      id: string;
      status: string;
      lock_token: string | null;
      winner_template_id: string | null;
      loser_template_id: string | null;
    }>();

  if (!campaign) {
    return c.json({ error: "Campaign not found" }, 404);
  }
  if (campaign.status !== "selection_pending") {
    return c.json({ error: `Cannot select winners in '${campaign.status}' status. Campaign must be in 'selection_pending' status.`, code: "CONFLICT" }, 409);
  }
  if (campaign.lock_token) {
    return c.json({ error: "Selection already in progress (locked)", code: "CONFLICT" }, 409);
  }

  // リクエストボディ: { winner_ig_user_ids: string[] }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const winnerIgUserIds = (body as Record<string, unknown>)?.winner_ig_user_ids;
  if (!Array.isArray(winnerIgUserIds) || !winnerIgUserIds.every((id) => typeof id === "string")) {
    return c.json({ error: "winner_ig_user_ids (string[]) is required" }, 400);
  }

  // lock_tokenで排他制御
  const lockToken = generateId();
  const lockResult = await db
    .prepare(
      "UPDATE campaigns SET lock_token = ?, locked_at = ?, updated_at = ? WHERE id = ? AND lock_token IS NULL AND status = 'selection_pending'",
    )
    .bind(lockToken, now, now, campaignId)
    .run();

  if ((lockResult.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Selection already in progress (locked)", code: "CONFLICT" }, 409);
  }

  const winnerSet = new Set(winnerIgUserIds as string[]);

  try {
    // 全pending応募者の結果を更新
    const allPending = await db
      .prepare(
        "SELECT id, ig_user_id FROM campaign_entries WHERE campaign_id = ? AND result = 'pending'",
      )
      .bind(campaignId)
      .all<{ id: string; ig_user_id: string }>();

    let winnersCount = 0;
    for (const entry of allPending.results) {
      const isWinner = winnerSet.has(entry.ig_user_id);
      await db
        .prepare(
          "UPDATE campaign_entries SET result = ?, result_reason = 'manual', selected_at = ? WHERE id = ? AND result = 'pending'",
        )
        .bind(isWinner ? "win" : "lose", now, entry.id)
        .run();
      if (isWinner) winnersCount++;
    }

    // dispatches作成
    const winnerTemplate = campaign.winner_template_id
      ? await db.prepare("SELECT body FROM templates WHERE id = ?").bind(campaign.winner_template_id).first<{ body: string }>()
      : null;
    const loserTemplate = campaign.loser_template_id
      ? await db.prepare("SELECT body FROM templates WHERE id = ?").bind(campaign.loser_template_id).first<{ body: string }>()
      : null;

    for (const entry of allPending.results) {
      const isWinner = winnerSet.has(entry.ig_user_id);
      const template = isWinner ? winnerTemplate : loserTemplate;
      if (!template) continue;

      const user = await db
        .prepare("SELECT ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ?")
        .bind(entry.ig_user_id, accountId)
        .first<{ ig_scoped_id: string }>();
      if (!user) continue;

      const dispatchId = generateId();
      await db
        .prepare(
          `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'dm', ?, 'pending', ?)
           ON CONFLICT(campaign_id, ig_user_id, dispatch_kind) DO NOTHING`,
        )
        .bind(dispatchId, campaignId, accountId, entry.ig_user_id, user.ig_scoped_id, isWinner ? "winner" : "loser", template.body, now)
        .run();
    }

    // dispatching遷移 + lock解放
    await db
      .prepare(
        "UPDATE campaigns SET status = 'dispatching', lock_token = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(now, campaignId)
      .run();

    return c.json({ status: "dispatching", winners: winnersCount, total: allPending.results.length });
  } catch (e) {
    // D1エラー時にlock解放
    await db
      .prepare("UPDATE campaigns SET lock_token = NULL, locked_at = NULL WHERE id = ?")
      .bind(campaignId)
      .run();
    return c.json({ error: e instanceof Error ? e.message : "Selection failed", code: "D1_ERROR" }, 500);
  }
});

// POST /api/campaigns/:id/resume — paused復帰
campaignRoutes.post("/:id/resume", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const campaignId = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const version = Number(body?.version);
  if (!Number.isInteger(version)) {
    return c.json({ error: "version (integer) is required" }, 400);
  }

  const engine = engineFrom(c.env.DB);
  const result = await engine.resume(accountId, campaignId, version);
  if (!result.ok) {
    return c.json(
      { error: result.error.message, code: result.error.code, details: result.error.details },
      errorStatus(result.error.code),
    );
  }
  return c.json(result.value);
});
