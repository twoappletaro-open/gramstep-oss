import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  ChatFiltersSchema,
  UpdateConversationStatusInputSchema,
  AssignOperatorInputSchema,
  SendManualMessageInputSchema,
} from "@gramstep/shared";
import { createWindowManager } from "../../services/window-manager.js";
import { createWindowExpiryService } from "../../services/window-expiry.js";
import { createAppReviewService } from "../../services/app-review-service.js";

export const chatRoutes = new Hono<{ Bindings: Env }>();

// GET /api/chats — チャットセッション一覧（最新メッセージ付きユーザーリスト）
chatRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const raw = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = ChatFiltersSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid filters", details: parsed.error.flatten() }, 400);
  }

  const { page, per_page, status, assigned_operator_id, search } = parsed.data;
  const offset = (page - 1) * per_page;

  const conditions: string[] = ["u.account_id = ?1", "u.is_deleted = 0"];
  const bindings: unknown[] = [accountId];
  let idx = 2;

  if (status) {
    conditions.push(`u.conversation_status = ?${idx}`);
    bindings.push(status);
    idx++;
  }
  if (assigned_operator_id) {
    conditions.push(`u.assigned_operator_id = ?${idx}`);
    bindings.push(assigned_operator_id);
    idx++;
  }
  if (search) {
    conditions.push(`(u.ig_username LIKE ?${idx} OR u.display_name LIKE ?${idx})`);
    bindings.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");

  const countStmt = c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM ig_users u WHERE ${where}`,
  ).bind(...bindings);
  const countRow = await countStmt.first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const dataStmt = c.env.DB.prepare(
    `SELECT u.id, u.ig_scoped_id, u.ig_username, u.display_name,
            u.conversation_status, u.assigned_operator_id,
            u.last_interaction_at, u.score, u.follower_status,
            u.profile_image_r2_key, u.is_opted_out, u.is_blocked,
            CASE WHEN ta.id IS NOT NULL THEN 1 ELSE 0 END as is_test_account,
            m.content as last_message_content,
            m.direction as last_message_direction,
            m.created_at as last_message_at
     FROM ig_users u
     LEFT JOIN test_accounts ta
       ON ta.account_id = u.account_id AND ta.ig_scoped_id = u.ig_scoped_id
     LEFT JOIN message_logs m ON m.id = (
       SELECT id FROM message_logs
       WHERE account_id = u.account_id AND ig_user_id = u.id
       ORDER BY created_at DESC LIMIT 1
     )
     WHERE ${where}
     ORDER BY u.last_interaction_at DESC
     LIMIT ?${idx} OFFSET ?${idx + 1}`,
  ).bind(...bindings, per_page, offset);

  const data = await dataStmt.all();

  return c.json({ data: data.results, total, page, per_page });
});

// GET /api/chats/:igUserId/messages — メッセージ履歴
chatRoutes.get("/:igUserId/messages", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const igUserId = c.req.param("igUserId");
  const url = new URL(c.req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 100);
  const before = url.searchParams.get("before");

  let query = `SELECT id, direction, message_type, content, source_type,
                      delivery_status, ig_message_id, media_r2_key, created_at
               FROM message_logs
               WHERE account_id = ?1 AND ig_user_id = ?2`;
  const bindings: unknown[] = [accountId, igUserId];

  if (before) {
    query += ` AND created_at < ?3`;
    bindings.push(Number(before));
  }

  query += ` ORDER BY created_at DESC LIMIT ?${bindings.length + 1}`;
  bindings.push(limit);

  const result = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(result.results);
});

// POST /api/chats/:igUserId/status — 対応ステータス更新
chatRoutes.post("/:igUserId/status", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const igUserId = c.req.param("igUserId");
  const body = await c.req.json();
  const parsed = UpdateConversationStatusInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE ig_users SET conversation_status = ?1, custom_status_label = ?2, updated_at = unixepoch()
     WHERE id = ?3 AND account_id = ?4`,
  )
    .bind(parsed.data.status, parsed.data.custom_label ?? null, igUserId, accountId)
    .run();

  return c.body(null, 204);
});

// POST /api/chats/:igUserId/assign — オペレーター割当
chatRoutes.post("/:igUserId/assign", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const igUserId = c.req.param("igUserId");
  const body = await c.req.json();
  const parsed = AssignOperatorInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE ig_users SET assigned_operator_id = ?1, updated_at = unixepoch()
     WHERE id = ?2 AND account_id = ?3`,
  )
    .bind(parsed.data.operator_id, igUserId, accountId)
    .run();

  return c.body(null, 204);
});

// POST /api/chats/:igUserId/take-control — ボット→オペレーター
chatRoutes.post("/:igUserId/take-control", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const op = c.get("operator" as never) as { id: string } | undefined;
  const operatorId = op?.id ?? "";
  const igUserId = c.req.param("igUserId");

  const user = await c.env.DB.prepare(
    `SELECT id, ig_scoped_id, conversation_status FROM ig_users WHERE id = ?1 AND account_id = ?2`,
  )
    .bind(igUserId, accountId)
    .first<{ id: string; ig_scoped_id: string; conversation_status: string }>();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Update control mode to human, assign operator, set status to in_progress
  await c.env.DB.prepare(
    `UPDATE ig_users SET control_mode = 'human', assigned_operator_id = ?1,
     conversation_status = 'in_progress', updated_at = unixepoch()
     WHERE id = ?2 AND account_id = ?3`,
  )
    .bind(operatorId, igUserId, accountId)
    .run();

  // Note: In production, this would also call Instagram Conversation Routing API
  // to pass_thread_control from bot to operator (Handover Protocol)

  return c.json({ control_mode: "human", ig_scoped_id: user.ig_scoped_id });
});

// POST /api/chats/:igUserId/release-control — オペレーター→ボット
chatRoutes.post("/:igUserId/release-control", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const igUserId = c.req.param("igUserId");

  const user = await c.env.DB.prepare(
    `SELECT id, ig_scoped_id, control_mode FROM ig_users WHERE id = ?1 AND account_id = ?2`,
  )
    .bind(igUserId, accountId)
    .first<{ id: string; ig_scoped_id: string; control_mode: string }>();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Update control mode to bot, set status to resolved
  await c.env.DB.prepare(
    `UPDATE ig_users SET control_mode = 'bot', conversation_status = 'resolved',
     updated_at = unixepoch() WHERE id = ?1 AND account_id = ?2`,
  )
    .bind(igUserId, accountId)
    .run();

  // Note: In production, this would also call Instagram Conversation Routing API
  // to take_thread_control back to bot

  return c.json({ control_mode: "bot", ig_scoped_id: user.ig_scoped_id });
});

// POST /api/chats/:igUserId/send — 手動メッセージ送信
chatRoutes.post("/:igUserId/send", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const igUserId = c.req.param("igUserId");
  const body = await c.req.json();
  const parsed = SendManualMessageInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, ig_scoped_id, control_mode, account_id FROM ig_users WHERE id = ?1 AND account_id = ?2`,
  )
    .bind(igUserId, accountId)
    .first<{ id: string; ig_scoped_id: string; control_mode: string; account_id: string }>();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const windowManager = createWindowManager({ db: c.env.DB, kv: c.env.KV });
  const windowExpiry = createWindowExpiryService({ db: c.env.DB, kv: c.env.KV });
  const appReviewService = createAppReviewService({ db: c.env.DB });

  const standardWindowActive = await windowManager.isWindowActive(accountId, igUserId);
  const humanAgentWindowActive = standardWindowActive
    ? true
    : await windowExpiry.isHumanAgentWindowActive(accountId, igUserId);

  let tag: "HUMAN_AGENT" | null = null;

  if (!standardWindowActive) {
    if (!humanAgentWindowActive) {
      return c.json({
        error: "Messaging window expired. Manual reply is allowed within 24 hours, or within 7 days only with HUMAN_AGENT approval.",
      }, 409);
    }

    const appReviewResult = await appReviewService.getSettings(accountId);
    if (!appReviewResult.ok || appReviewResult.value.human_agent_status !== "approved") {
      return c.json({
        error: "HUMAN_AGENT permission is not approved for this account. Send a user message first, or complete Meta App Review.",
      }, 409);
    }

    tag = "HUMAN_AGENT";
  }

  // Record the manual message in message_logs
  const messageId = crypto.randomUUID().replace(/-/g, "");
  await c.env.DB.prepare(
    `INSERT INTO message_logs (id, account_id, ig_user_id, direction, message_type, content, source_type, delivery_status)
     VALUES (?1, ?2, ?3, 'outbound', ?4, ?5, 'manual', 'queued')`,
  )
    .bind(messageId, accountId, igUserId, parsed.data.message_type, parsed.data.content)
    .run();

  // HUMAN_AGENT タグ付きで SEND_QUEUE にエンキュー（7日ウィンドウで送信）
  const messagePayload: Record<string, string> = { type: parsed.data.message_type, text: parsed.data.content };
  if (parsed.data.message_type === "image" && parsed.data.media_url) {
    messagePayload.url = parsed.data.media_url;
  }

  await (c.env.SEND_QUEUE as Queue).send({
    id: messageId,
    accountId,
    igUserId,
    recipientId: user.ig_scoped_id,
    messagePayload: JSON.stringify(messagePayload),
    mediaCategory: parsed.data.message_type === "image" ? "image" : "text",
    sourceType: "manual",
    sourceId: null,
    enrollmentId: null,
    retryCount: 0,
    mediaUrl: parsed.data.media_url ?? null,
    mediaUrlHash: null,
    tag,
  });

  return c.json({
    message_id: messageId,
    status: "queued",
    delivery_mode: tag === "HUMAN_AGENT" ? "human_agent" : "response",
  });
});
