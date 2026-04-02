import { type ConditionConfig } from "@gramstep/shared";
import { z } from "zod";

export type ConditionResult =
  | { type: "branch"; nextStepOrder: number }
  | { type: "skip" };

export interface UserContext {
  igUserId: string;
  accountId: string;
}

export interface ConditionEvaluatorDeps {
  db: D1Database;
}

interface UserData {
  score: number;
  metadata: Record<string, string>;
  followerStatus: string;
  tags: string[];
  hasDmHistory: boolean;
}

async function fetchUserData(
  db: D1Database,
  ctx: UserContext,
): Promise<UserData> {
  const userRow = await db
    .prepare(
      "SELECT score, metadata, follower_status FROM ig_users WHERE id = ? AND account_id = ?",
    )
    .bind(ctx.igUserId, ctx.accountId)
    .first<{ score: number; metadata: string; follower_status: string | null }>();

  const tagRows = await db
    .prepare(
      "SELECT t.name FROM tags t JOIN ig_user_tags ut ON t.id = ut.tag_id WHERE ut.ig_user_id = ?",
    )
    .bind(ctx.igUserId)
    .all<{ name: string }>();

  const dmRow = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM message_logs WHERE ig_user_id = ? AND account_id = ? AND direction = 'inbound' LIMIT 1",
    )
    .bind(ctx.igUserId, ctx.accountId)
    .first<{ cnt: number }>();

  let metadata: Record<string, string> = {};
  try {
    const metaParsed = z.record(z.string()).safeParse(JSON.parse(userRow?.metadata ?? "{}"));
    metadata = metaParsed.success ? metaParsed.data : {};
  } catch {
    metadata = {};
  }

  return {
    score: userRow?.score ?? 0,
    metadata,
    followerStatus: userRow?.follower_status ?? "unknown",
    tags: (tagRows.results ?? []).map((r) => r.name),
    hasDmHistory: (dmRow?.cnt ?? 0) > 0,
  };
}

function evaluateSingleCondition(
  condition: ConditionConfig["conditions"][number],
  userData: UserData,
): boolean {
  const { field, operator, value } = condition;

  switch (field) {
    case "tag": {
      const strValue = String(value);
      if (operator === "has") return userData.tags.includes(strValue);
      if (operator === "not_has") return !userData.tags.includes(strValue);
      return false;
    }

    case "score": {
      const numValue = typeof value === "number" ? value : parseFloat(String(value));
      const score = userData.score;
      switch (operator) {
        case "eq": return score === numValue;
        case "neq": return score !== numValue;
        case "gt": return score > numValue;
        case "gte": return score >= numValue;
        case "lt": return score < numValue;
        case "lte": return score <= numValue;
        default: return false;
      }
    }

    case "metadata": {
      const key = condition.key ?? "";
      const actual = userData.metadata[key] ?? "";
      const expected = String(value);
      switch (operator) {
        case "eq": return actual === expected;
        case "neq": return actual !== expected;
        default: return false;
      }
    }

    case "follower_status": {
      const expected = String(value);
      switch (operator) {
        case "eq": return userData.followerStatus === expected;
        case "neq": return userData.followerStatus !== expected;
        default: return false;
      }
    }

    case "has_dm_history": {
      const expected = String(value) === "true";
      switch (operator) {
        case "eq": return userData.hasDmHistory === expected;
        case "neq": return userData.hasDmHistory !== expected;
        default: return false;
      }
    }

    default:
      return false;
  }
}

export async function evaluateCondition(
  config: ConditionConfig,
  ctx: UserContext,
  deps: ConditionEvaluatorDeps,
): Promise<ConditionResult> {
  const userData = await fetchUserData(deps.db, ctx);

  for (const condition of config.conditions) {
    if (evaluateSingleCondition(condition, userData)) {
      return { type: "branch", nextStepOrder: condition.next_step_order };
    }
  }

  return { type: "branch", nextStepOrder: config.default_next_step_order };
}
