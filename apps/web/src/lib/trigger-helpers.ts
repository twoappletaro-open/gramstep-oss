import type { MatchType, FireMode } from "@gramstep/shared";

const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  exact: "完全一致",
  partial: "部分一致",
  regex: "正規表現",
};

export function formatMatchTypeLabel(type: string): string {
  return MATCH_TYPE_LABELS[type as MatchType] ?? type;
}

const FIRE_MODE_LABELS: Record<FireMode, string> = {
  once: "1回のみ",
  unlimited: "無制限",
  first_only: "初回のみ",
};

export function formatFireModeLabel(mode: string): string {
  return FIRE_MODE_LABELS[mode as FireMode] ?? mode;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  send_template: "テンプレート送信",
  add_tag: "タグ追加",
  remove_tag: "タグ削除",
  enroll_scenario: "シナリオ登録",
  start_survey: "アンケート開始",
  webhook: "Webhook通知",
  update_metadata: "メタデータ更新",
  update_score: "スコア変更",
  send_reaction: "リアクション送信",
};

export function formatActionTypeLabel(type: string): string {
  return ACTION_TYPE_LABELS[type] ?? type;
}
