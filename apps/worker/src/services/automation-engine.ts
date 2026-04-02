import type {
  Result,
  AppError,
  TriggerAction,
  AutomationCondition,
  AutomationConditionGroup,
} from "@gramstep/shared";
import { ok } from "@gramstep/shared";

export interface AutomationRuleView {
  id: string;
  accountId: string;
  name: string;
  conditionGroup: AutomationConditionGroup;
  actions: TriggerAction[];
  isActive: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRuleMatch {
  ruleId: string;
  ruleName: string;
  actions: TriggerAction[];
}

interface AutomationRuleRow {
  id: string;
  account_id: string;
  name: string;
  condition_group: string;
  actions: string;
  is_active: number;
  version: number;
  created_at: number;
  updated_at: number;
}

interface UserData {
  score: number;
  metadata: Record<string, string>;
  tags: string[];
}

export interface AutomationEngineDeps {
  db: D1Database;
}

export interface AutomationEngineService {
  evaluateRules(
    accountId: string,
    igUserId: string,
  ): Promise<Result<AutomationRuleMatch[], AppError>>;
}

async function fetchUserData(db: D1Database, accountId: string, igUserId: string): Promise<UserData> {
  const userRow = await db
    .prepare("SELECT score, metadata FROM ig_users WHERE id = ? AND account_id = ?")
    .bind(igUserId, accountId)
    .first<{ score: number; metadata: string }>();

  const tagRows = await db
    .prepare("SELECT t.name FROM tags t JOIN ig_user_tags ut ON t.id = ut.tag_id WHERE ut.ig_user_id = ?")
    .bind(igUserId)
    .all<{ name: string }>();

  let metadata: Record<string, string> = {};
  try {
    metadata = JSON.parse(userRow?.metadata ?? "{}");
  } catch {
    metadata = {};
  }

  return {
    score: userRow?.score ?? 0,
    metadata,
    tags: (tagRows.results ?? []).map((r) => r.name),
  };
}

function evaluateSingleCondition(condition: AutomationCondition, userData: UserData): boolean {
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

    default:
      return false;
  }
}

function evaluateConditionGroup(group: AutomationConditionGroup, userData: UserData): boolean {
  if (group.logic === "and") {
    return group.conditions.every((c) => evaluateSingleCondition(c, userData));
  }
  return group.conditions.some((c) => evaluateSingleCondition(c, userData));
}

export function createAutomationEngine(deps: AutomationEngineDeps): AutomationEngineService {
  const { db } = deps;

  return {
    async evaluateRules(accountId, igUserId) {
      const result = await db
        .prepare("SELECT * FROM automation_rules WHERE account_id = ? AND is_active = 1 ORDER BY created_at ASC")
        .bind(accountId)
        .all<AutomationRuleRow>();

      const rules = result.results ?? [];
      if (rules.length === 0) {
        return ok([]);
      }

      const userData = await fetchUserData(db, accountId, igUserId);
      const matches: AutomationRuleMatch[] = [];

      for (const rule of rules) {
        const conditionGroup: AutomationConditionGroup = JSON.parse(rule.condition_group);
        const actions: TriggerAction[] = JSON.parse(rule.actions);

        if (evaluateConditionGroup(conditionGroup, userData)) {
          matches.push({
            ruleId: rule.id,
            ruleName: rule.name,
            actions,
          });
        }
      }

      return ok(matches);
    },
  };
}
