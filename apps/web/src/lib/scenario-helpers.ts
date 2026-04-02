import type { TriggerType } from "@gramstep/shared";

export function formatScenarioStatus(isActive: boolean): "active" | "inactive" {
  return isActive ? "active" : "inactive";
}

const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  comment: "コメント",
  story_comment: "ストーリーコメント",
  story_mention: "ストーリーメンション",
  live_comment: "ライブコメント",
  dm: "DM",
  url_param: "URLパラメータ",
  ice_breaker: "Ice Breaker",
};

export function formatTriggerTypeLabel(type: string): string {
  return TRIGGER_TYPE_LABELS[type as TriggerType] ?? type;
}

export function buildScenarioListUrl(
  params?: { page?: number; limit?: number; status?: string },
): string {
  const p = new URLSearchParams();
  p.set("page", String(params?.page ?? 1));
  p.set("limit", String(params?.limit ?? 20));
  if (params?.status) p.set("status", params.status);
  return `/api/scenarios?${p}`;
}
