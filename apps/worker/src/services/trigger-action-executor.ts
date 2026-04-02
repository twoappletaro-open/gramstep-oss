import { generateId } from "@gramstep/db";
import type { Result, AppError, TriggerAction } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import type { IInstagramClient } from "@gramstep/ig-sdk";
import type { EnrollmentServiceInterface } from "./enrollment-service.js";

const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;
const TWENTY_FOUR_HOURS_SECONDS = 24 * 3600;
const MAX_COMMENT_REPLY_PATTERNS = 10;

export interface ActionContext {
  accountId: string;
  igUserId: string;
  triggerId: string;
  accessToken: string;
  appSecretProof: string;
  recipientId: string;
  commentId?: string;
  commentCreatedAt?: number;
  templateText?: string;
}

export interface CommentReplyConfig {
  commentId: string;
  replyPatterns: string[];
}

export interface TriggerActionExecutorService {
  executeAction(action: TriggerAction, ctx: ActionContext): Promise<Result<void, AppError>>;
  executeActions(actions: TriggerAction[], ctx: ActionContext): Promise<Result<void, AppError>>;
  sendPrivateReply(ctx: ActionContext, message: string): Promise<Result<void, AppError>>;
  checkCommentDmLimit(accountId: string, igUserId: string): Promise<boolean>;
  recordCommentDmSent(accountId: string, igUserId: string): Promise<void>;
  sendCommentReply(config: CommentReplyConfig, ctx: ActionContext): Promise<Result<void, AppError>>;
}

export interface TriggerActionExecutorDeps {
  db: D1Database;
  kv: KVNamespace;
  igClient: IInstagramClient;
  enrollmentService: EnrollmentServiceInterface;
  sendQueue: Queue<import("@gramstep/shared").SendQueueMessage>;
  fetchFn: typeof fetch;
  isWindowActive?: (accountId: string, igUserId: string) => Promise<boolean>;
}

export function createTriggerActionExecutor(
  deps: TriggerActionExecutorDeps,
): TriggerActionExecutorService {
  const { db, igClient, enrollmentService, sendQueue, fetchFn } = deps;

  async function executeAction(
    action: TriggerAction,
    ctx: ActionContext,
  ): Promise<Result<void, AppError>> {
    switch (action.type) {
      case "add_tag":
        return addTag(ctx.igUserId, action.tagId);
      case "remove_tag":
        return removeTag(ctx.igUserId, action.tagId);
      case "enroll_scenario":
        return enrollScenario(action.scenarioId, ctx);
      case "start_survey":
        return startSurvey(action.surveyId, ctx);
      case "webhook":
        return sendWebhook(action.url, ctx);
      case "update_metadata":
        return updateMetadata(ctx.igUserId, action.key, action.value);
      case "update_score":
        return updateScore(ctx.igUserId, action.delta);
      case "send_reaction":
        return sendReaction(ctx, action.emoji);
      case "send_template":
        return sendTemplate(ctx);
      case "enter_campaign":
        return enterCampaign(action.campaignId, ctx);
    }
  }

  async function addTag(igUserId: string, tagId: string): Promise<Result<void, AppError>> {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare("INSERT OR IGNORE INTO ig_user_tags (ig_user_id, tag_id, created_at) VALUES (?, ?, ?)")
      .bind(igUserId, tagId, now)
      .run();
    return ok(undefined);
  }

  async function removeTag(igUserId: string, tagId: string): Promise<Result<void, AppError>> {
    await db
      .prepare("DELETE FROM ig_user_tags WHERE ig_user_id = ? AND tag_id = ?")
      .bind(igUserId, tagId)
      .run();
    return ok(undefined);
  }

  async function enrollScenario(
    scenarioId: string,
    ctx: ActionContext,
  ): Promise<Result<void, AppError>> {
    const result = await enrollmentService.enrollUser(scenarioId, ctx.igUserId, ctx.accountId);
    if (!result.ok) {
      return err(result.error);
    }
    return ok(undefined);
  }

  async function startSurvey(
    surveyId: string,
    ctx: ActionContext,
  ): Promise<Result<void, AppError>> {
    const { createSurveyService } = await import("./survey-service.js");
    const surveyService = createSurveyService({
      db,
      sendQueue,
    });
    const result = await surveyService.startSurveyForUser(
      surveyId,
      ctx.accountId,
      ctx.igUserId,
      ctx.recipientId,
    );
    if (!result.ok) {
      return err(result.error);
    }
    return ok(undefined);
  }

  async function sendWebhook(url: string, ctx: ActionContext): Promise<Result<void, AppError>> {
    const payload = {
      event: "trigger_fired",
      triggerId: ctx.triggerId,
      accountId: ctx.accountId,
      igUserId: ctx.igUserId,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return err(
        createAppError("EXTERNAL_ERROR", `Webhook returned ${response.status}`),
      );
    }
    return ok(undefined);
  }

  async function updateMetadata(
    igUserId: string,
    key: string,
    value: string,
  ): Promise<Result<void, AppError>> {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "UPDATE ig_users SET metadata = JSON_SET(metadata, '$.' || ?, ?), updated_at = ? WHERE id = ?",
      )
      .bind(key, value, now, igUserId)
      .run();
    return ok(undefined);
  }

  async function updateScore(igUserId: string, delta: number): Promise<Result<void, AppError>> {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare("UPDATE ig_users SET score = score + ?, updated_at = ? WHERE id = ?")
      .bind(delta, now, igUserId)
      .run();
    return ok(undefined);
  }

  async function sendReaction(ctx: ActionContext, emoji: string): Promise<Result<void, AppError>> {
    const result = await igClient.sendMessage(
      ctx.accessToken,
      {
        recipientId: ctx.recipientId,
        message: { type: "text", text: emoji },
      },
      ctx.appSecretProof,
    );

    if (!result.ok) {
      return err(
        createAppError("INSTAGRAM_API_ERROR", `Failed to send reaction: ${result.error.message}`),
      );
    }
    return ok(undefined);
  }

  async function sendTemplate(ctx: ActionContext): Promise<Result<void, AppError>> {
    // Phase 1: テキスト直送信のみ（Phase 2のTask 16.1完了後にテンプレートエンジン連携に差替え）
    const text = ctx.templateText ?? "";
    if (!text) {
      return err(createAppError("VALIDATION_ERROR", "templateText is required in Phase 1"));
    }

    const result = await igClient.sendMessage(
      ctx.accessToken,
      {
        recipientId: ctx.recipientId,
        message: { type: "text", text },
      },
      ctx.appSecretProof,
    );

    if (!result.ok) {
      return err(
        createAppError("INSTAGRAM_API_ERROR", `Failed to send template: ${result.error.message}`),
      );
    }
    return ok(undefined);
  }

  async function sendPrivateReply(
    ctx: ActionContext,
    message: string,
  ): Promise<Result<void, AppError>> {
    if (!ctx.commentId) {
      return err(createAppError("VALIDATION_ERROR", "commentId is required for Private Reply"));
    }

    // 7日制限チェック
    const now = Math.floor(Date.now() / 1000);
    if (ctx.commentCreatedAt !== undefined) {
      const age = now - ctx.commentCreatedAt;
      if (age > SEVEN_DAYS_SECONDS) {
        return err(createAppError("EXPIRED", "Comment is older than 7 days"));
      }
    }

    // 重複防止チェック
    const existing = await db
      .prepare("SELECT id FROM private_replies_sent WHERE comment_id = ?")
      .bind(ctx.commentId)
      .first<{ id: string }>();

    if (existing) {
      return err(createAppError("DUPLICATE", "Private Reply already sent for this comment"));
    }

    // Private Reply送信
    const result = await igClient.sendPrivateReply(
      ctx.commentId,
      message,
      ctx.accessToken,
      ctx.appSecretProof,
    );

    if (!result.ok) {
      return err(
        createAppError("INSTAGRAM_API_ERROR", `Private Reply failed: ${result.error.message}`),
      );
    }

    // 送信記録
    const id = generateId();
    await db
      .prepare(
        "INSERT INTO private_replies_sent (id, account_id, comment_id, ig_user_id, sent_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, ctx.accountId, ctx.commentId, ctx.igUserId, now)
      .run();

    return ok(undefined);
  }

  async function checkCommentDmLimit(accountId: string, igUserId: string): Promise<boolean> {
    const since = Math.floor(Date.now() / 1000) - TWENTY_FOUR_HOURS_SECONDS;
    const row = await db
      .prepare(
        "SELECT COUNT(*) as count FROM comment_dm_limits WHERE account_id = ? AND ig_user_id = ? AND sent_at >= ?",
      )
      .bind(accountId, igUserId, since)
      .first<{ count: number }>();

    return (row?.count ?? 0) > 0;
  }

  async function recordCommentDmSent(accountId: string, igUserId: string): Promise<void> {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare("INSERT INTO comment_dm_limits (id, account_id, ig_user_id, sent_at) VALUES (?, ?, ?, ?)")
      .bind(id, accountId, igUserId, now)
      .run();
  }

  async function enterCampaign(
    campaignId: string,
    ctx: ActionContext,
  ): Promise<Result<void, AppError>> {
    const now = Math.floor(Date.now() / 1000);

    // キャンペーン取得（active状態のみ）
    const campaign = await db
      .prepare(
        "SELECT id, kind, status, duplicate_action, win_probability, remaining_winner_slots, winner_template_id, loser_template_id, winner_actions, loser_actions, entry_start_at, entry_end_at, entry_confirm_enabled, entry_confirm_template_id FROM campaigns WHERE id = ? AND account_id = ? AND status = 'active'",
      )
      .bind(campaignId, ctx.accountId)
      .first<{
        id: string;
        kind: string;
        status: string;
        duplicate_action: string;
        win_probability: number | null;
        remaining_winner_slots: number | null;
        winner_template_id: string | null;
        loser_template_id: string | null;
        winner_actions: string;
        loser_actions: string;
        entry_start_at: number | null;
        entry_end_at: number | null;
        entry_confirm_enabled: number;
        entry_confirm_template_id: string | null;
      }>();

    if (!campaign) {
      return err(createAppError("NOT_FOUND", "Campaign not found or not active"));
    }

    // 期間チェック
    if (campaign.entry_start_at && now < campaign.entry_start_at) {
      return ok(undefined);
    }
    if (campaign.entry_end_at && now > campaign.entry_end_at) {
      return ok(undefined);
    }

    // 重複チェック: INSERT ON CONFLICT DO NOTHING
    const entryId = generateId();
    const insertResult = await db
      .prepare(
        `INSERT INTO campaign_entries (id, campaign_id, account_id, ig_user_id, source_trigger_id, source_comment_id, source_comment_created_at, result, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(campaign_id, ig_user_id) DO NOTHING`,
      )
      .bind(
        entryId,
        campaignId,
        ctx.accountId,
        ctx.igUserId,
        ctx.triggerId,
        ctx.commentId ?? null,
        ctx.commentCreatedAt ?? null,
        now,
      )
      .run();

    if ((insertResult.meta?.changes ?? 0) === 0) {
      // 重複応募
      if (campaign.duplicate_action === "send_message") {
        // 「既に参加済み」テンプレートDM送信
        const result = await igClient.sendMessage(
          ctx.accessToken,
          {
            recipientId: ctx.recipientId,
            message: { type: "text", text: "既にこのキャンペーンに参加済みです。" },
          },
          ctx.appSecretProof,
        );
        void result;
      }
      return ok(undefined);
    }

    // 即時抽選判定
    if (campaign.kind === "instant_win") {
      return executeInstantWin(campaign, entryId, ctx, now);
    }

    // deferred_lottery: 応募登録完了 + 応募確認DM送信
    if (campaign.kind === "deferred_lottery" && campaign.entry_confirm_enabled === 1 && campaign.entry_confirm_template_id) {
      const confirmTemplate = await db
        .prepare("SELECT id, body, type FROM templates WHERE id = ?")
        .bind(campaign.entry_confirm_template_id)
        .first<{ id: string; body: string; type: string }>();

      if (confirmTemplate) {
        const dispatchId = generateId();
        await db
          .prepare(
            `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, queued_at, created_at)
             VALUES (?, ?, ?, ?, ?, 'entry_confirm', 'dm', ?, 'queued', ?, ?)`,
          )
          .bind(dispatchId, campaign.id, ctx.accountId, ctx.igUserId, ctx.recipientId, confirmTemplate.body, now, now)
          .run();

        await sendQueue.send({
          id: generateId(),
          accountId: ctx.accountId,
          igUserId: ctx.igUserId,
          recipientId: ctx.recipientId,
          messagePayload: confirmTemplate.body,
          mediaCategory: confirmTemplate.type === "image" ? "image" : "text",
          sourceType: "campaign",
          sourceId: campaign.id,
          enrollmentId: null,
          retryCount: 0,
          dispatchId,
        });
      }
    }

    return ok(undefined);
  }

  async function executeInstantWin(
    campaign: {
      id: string;
      win_probability: number | null;
      remaining_winner_slots: number | null;
      winner_template_id: string | null;
      loser_template_id: string | null;
      winner_actions: string;
      loser_actions: string;
    },
    entryId: string,
    ctx: ActionContext,
    now: number,
  ): Promise<Result<void, AppError>> {
    const roll = Math.random() * 100;
    let won = false;

    if (roll < (campaign.win_probability ?? 0)) {
      // アトミック減算で当選枠確保
      const reserve = await db
        .prepare(
          `UPDATE campaigns SET remaining_winner_slots = remaining_winner_slots - 1, updated_at = ?
           WHERE id = ? AND status = 'active' AND remaining_winner_slots > 0`,
        )
        .bind(now, campaign.id)
        .run();
      won = (reserve.meta?.changes ?? 0) === 1;
    }

    const result = won ? "win" : "lose";
    const resultReason = won
      ? "probability"
      : roll >= (campaign.win_probability ?? 0)
        ? "probability"
        : "slots_exhausted";

    // entry の result を更新
    await db
      .prepare(
        "UPDATE campaign_entries SET result = ?, result_reason = ?, selected_at = ? WHERE id = ? AND result = 'pending'",
      )
      .bind(result, resultReason, now, entryId)
      .run();

    // テンプレート取得
    const templateId = won ? campaign.winner_template_id : campaign.loser_template_id;
    if (!templateId) return ok(undefined);

    const template = await db
      .prepare("SELECT id, body, type FROM templates WHERE id = ?")
      .bind(templateId)
      .first<{ id: string; body: string; type: string }>();
    if (!template) return ok(undefined);

    // 送信経路決定
    let windowActive: boolean;
    if (deps.isWindowActive) {
      windowActive = await deps.isWindowActive(ctx.accountId, ctx.igUserId);
    } else {
      const { createWindowManager } = await import("./window-manager.js");
      const windowMgr = createWindowManager({ db, kv: deps.kv });
      windowActive = await windowMgr.isWindowActive(ctx.accountId, ctx.igUserId);
    }

    const SEVEN_DAYS = 7 * 24 * 3600;
    const dispatchKind = won ? "winner" : "loser";

    if (windowActive) {
      // DM window active → Queue経由送信
      const dispatchId = generateId();
      await db
        .prepare(
          `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, queued_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'dm', ?, 'queued', ?, ?)`,
        )
        .bind(dispatchId, campaign.id, ctx.accountId, ctx.igUserId, ctx.recipientId, dispatchKind, template.body, now, now)
        .run();

      await sendQueue.send({
        id: generateId(),
        accountId: ctx.accountId,
        igUserId: ctx.igUserId,
        recipientId: ctx.recipientId,
        messagePayload: template.body,
        mediaCategory: template.type === "image" ? "image" : "text",
        sourceType: "campaign",
        sourceId: campaign.id,
        enrollmentId: null,
        retryCount: 0,
        dispatchId,
      });
    } else if (
      ctx.commentId &&
      ctx.commentCreatedAt !== undefined &&
      now - ctx.commentCreatedAt < SEVEN_DAYS
    ) {
      // Private Reply（コメント7日以内）
      const dispatchId = generateId();
      await db
        .prepare(
          `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, comment_id, message_payload, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'private_reply', ?, ?, 'pending', ?)`,
        )
        .bind(dispatchId, campaign.id, ctx.accountId, ctx.igUserId, ctx.recipientId, dispatchKind, ctx.commentId, template.body, now)
        .run();

      const sendResult = await igClient.sendPrivateReply(
        ctx.commentId,
        template.body,
        ctx.accessToken,
        ctx.appSecretProof,
      );
      const status = sendResult.ok ? "sent" : "failed";
      const timeCol = status === "sent" ? "sent_at" : "failed_at";
      await db
        .prepare(
          `UPDATE campaign_dispatches SET status = ?, ${timeCol} = ? WHERE id = ?`,
        )
        .bind(status, now, dispatchId)
        .run();
    } else {
      // 送信不可 → skipped
      const dispatchId = generateId();
      await db
        .prepare(
          `INSERT INTO campaign_dispatches (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, message_payload, status, skip_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'dm', ?, 'skipped', 'no_window', ?)`,
        )
        .bind(dispatchId, campaign.id, ctx.accountId, ctx.igUserId, ctx.recipientId, dispatchKind, template.body, now)
        .run();
    }

    // 当選/落選アクション実行
    try {
      const actionsJson = won ? campaign.winner_actions : campaign.loser_actions;
      const actions: TriggerAction[] = JSON.parse(actionsJson);
      for (const action of actions) {
        // enter_campaign の再帰防止
        if (action.type === "enter_campaign") continue;
        await executeAction(action, ctx);
      }
    } catch {
      // アクション実行失敗は抽選結果に影響させない
    }

    return ok(undefined);
  }

  async function sendCommentReply(
    config: CommentReplyConfig,
    ctx: ActionContext,
  ): Promise<Result<void, AppError>> {
    const patterns = config.replyPatterns.slice(0, MAX_COMMENT_REPLY_PATTERNS);
    if (patterns.length === 0) {
      return err(createAppError("VALIDATION_ERROR", "No reply patterns provided"));
    }

    const selectedPattern = patterns[Math.floor(Math.random() * patterns.length)] ?? patterns[0] ?? "";

    const result = await igClient.sendMessage(
      ctx.accessToken,
      {
        recipientId: ctx.recipientId,
        message: { type: "text", text: selectedPattern },
      },
      ctx.appSecretProof,
    );

    if (!result.ok) {
      return err(
        createAppError("INSTAGRAM_API_ERROR", `Comment reply failed: ${result.error.message}`),
      );
    }
    return ok(undefined);
  }

  async function executeActions(
    actions: TriggerAction[],
    ctx: ActionContext,
  ): Promise<Result<void, AppError>> {
    for (const action of actions) {
      const result = await executeAction(action, ctx);
      if (!result.ok) {
        return result;
      }
    }

    // 発火ログ記録
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare("INSERT INTO trigger_fire_logs (id, trigger_id, ig_user_id, fired_at) VALUES (?, ?, ?, ?)")
      .bind(id, ctx.triggerId, ctx.igUserId, now)
      .run();

    return ok(undefined);
  }

  return {
    executeAction,
    executeActions,
    sendPrivateReply,
    checkCommentDmLimit,
    recordCommentDmSent,
    sendCommentReply,
  };
}
