const CONDITION_FIELD_LABELS: Record<string, string> = {
  tag: "タグ",
  score: "スコア",
  metadata: "メタデータ",
};

export function formatConditionFieldLabel(field: string): string {
  return CONDITION_FIELD_LABELS[field] ?? field;
}

const CONDITION_OPERATOR_LABELS: Record<string, string> = {
  has: "持っている",
  not_has: "持っていない",
  eq: "等しい",
  neq: "等しくない",
  gt: "より大きい",
  gte: "以上",
  lt: "未満",
  lte: "以下",
};

export function formatConditionOperatorLabel(operator: string): string {
  return CONDITION_OPERATOR_LABELS[operator] ?? operator;
}

const LOGIC_LABELS: Record<string, string> = {
  and: "すべて満たす (AND)",
  or: "いずれか満たす (OR)",
};

export function formatLogicLabel(logic: string): string {
  return LOGIC_LABELS[logic] ?? logic;
}
