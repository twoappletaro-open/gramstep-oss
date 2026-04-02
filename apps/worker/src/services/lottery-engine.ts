import { generateId } from "@gramstep/db";
import type { Result, AppError, LotteryConfig, LotteryResult } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

export interface InstantDrawResult {
  result: LotteryResult;
  message: string;
}

export interface BatchDrawResult {
  winners: string[];
  losers: string[];
  winMessage: string;
  loseMessage: string;
}

interface LotteryEntryRow {
  id: string;
  lottery_id: string;
  ig_user_id: string;
  result: string;
  entered_at: number;
}

export interface LotteryEngineDeps {
  db: D1Database;
}

export interface LotteryEngineService {
  drawInstant(
    lotteryId: string,
    igUserId: string,
    config: LotteryConfig,
  ): Promise<Result<InstantDrawResult, AppError>>;

  registerEntry(
    lotteryId: string,
    igUserId: string,
    config: LotteryConfig,
  ): Promise<Result<void, AppError>>;

  executeBatchDraw(
    lotteryId: string,
    config: LotteryConfig,
  ): Promise<Result<BatchDrawResult, AppError>>;
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

export function createLotteryEngine(deps: LotteryEngineDeps): LotteryEngineService {
  const { db } = deps;

  return {
    async drawInstant(lotteryId, igUserId, config) {
      // 重複チェック
      const existing = await db
        .prepare("SELECT id FROM lottery_entries WHERE lottery_id = ? AND ig_user_id = ?")
        .bind(lotteryId, igUserId)
        .first<{ id: string }>();

      if (existing) {
        return err(createAppError("DUPLICATE", "既に抽選に参加済みです"));
      }

      // 当選者数カウント
      const winCount = await db
        .prepare("SELECT COUNT(*) as count FROM lottery_entries WHERE lottery_id = ? AND result = 'win'")
        .bind(lotteryId)
        .first<{ count: number }>();

      const currentWinners = winCount?.count ?? 0;
      let drawResult: LotteryResult;

      if (currentWinners >= config.max_winners) {
        drawResult = "lose";
      } else {
        const roll = Math.random() * 100;
        drawResult = roll < config.win_probability ? "win" : "lose";
      }

      // エントリ記録
      const id = generateId();
      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare("INSERT INTO lottery_entries (id, lottery_id, ig_user_id, result, entered_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, lotteryId, igUserId, drawResult, now)
        .run();

      return ok({
        result: drawResult,
        message: drawResult === "win" ? config.win_message : config.lose_message,
      });
    },

    async registerEntry(lotteryId, igUserId, config) {
      // 締切チェック
      if (config.deadline !== null) {
        const now = Math.floor(Date.now() / 1000);
        if (now > config.deadline) {
          return err(createAppError("EXPIRED", "応募期間が終了しています"));
        }
      }

      // 重複チェック
      const existing = await db
        .prepare("SELECT id FROM lottery_entries WHERE lottery_id = ? AND ig_user_id = ?")
        .bind(lotteryId, igUserId)
        .first<{ id: string }>();

      if (existing) {
        return err(createAppError("DUPLICATE", "既に応募済みです"));
      }

      // エントリ記録（pending状態）
      const id = generateId();
      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare("INSERT INTO lottery_entries (id, lottery_id, ig_user_id, result, entered_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, lotteryId, igUserId, "pending", now)
        .run();

      return ok(undefined);
    },

    async executeBatchDraw(lotteryId, config) {
      // 全pending応募者を取得
      const entriesResult = await db
        .prepare("SELECT * FROM lottery_entries WHERE lottery_id = ? AND result = 'pending' ORDER BY entered_at ASC")
        .bind(lotteryId)
        .all<LotteryEntryRow>();

      const entries = entriesResult.results ?? [];
      if (entries.length === 0) {
        return ok({ winners: [], losers: [], winMessage: config.win_message, loseMessage: config.lose_message });
      }

      // シャッフルして当選者を選出
      const shuffled = shuffleArray(entries);
      const winnerCount = Math.min(config.max_winners, shuffled.length);
      const winners = shuffled.slice(0, winnerCount);
      const losers = shuffled.slice(winnerCount);

      // DB更新
      for (const entry of winners) {
        await db
          .prepare("UPDATE lottery_entries SET result = ? WHERE id = ?")
          .bind("win", entry.id)
          .run();
      }

      for (const entry of losers) {
        await db
          .prepare("UPDATE lottery_entries SET result = ? WHERE id = ?")
          .bind("lose", entry.id)
          .run();
      }

      return ok({
        winners: winners.map((e) => e.ig_user_id),
        losers: losers.map((e) => e.ig_user_id),
        winMessage: config.win_message,
        loseMessage: config.lose_message,
      });
    },
  };
}
