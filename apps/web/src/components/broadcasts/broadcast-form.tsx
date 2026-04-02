"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { createApiClient, getApiUrl } from "../../lib/api-client";

type PackageOption = {
  id: string;
  name: string;
};

type TagOption = {
  name: string;
};

type SegmentCondition = {
  field: "tag" | "metadata" | "score" | "follower_status";
  operator: "has" | "not_has" | "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  value: string | number;
  key?: string;
};

type SegmentFilter = {
  logic: "and" | "or";
  conditions: SegmentCondition[];
};

type BroadcastPreview = {
  total_matched: number;
  total_recipients: number;
  excluded_no_window: number;
  excluded_no_response: number;
};

export type BroadcastFormData = {
  id?: string;
  name: string;
  template_id: string;
  segment: SegmentFilter;
  status?: string;
  scheduled_at: number | null;
};

type SubmitMode = "draft" | "publish";

export function BroadcastForm({
  accountId,
  initialData,
  loading,
  onSubmit,
}: {
  accountId: string;
  initialData?: BroadcastFormData | null;
  loading: boolean;
  onSubmit: (payload: BroadcastFormData, mode: SubmitMode) => Promise<void>;
}) {
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const [name, setName] = useState(initialData?.name ?? "");
  const [templateId, setTemplateId] = useState(initialData?.template_id ?? "");
  const [audienceType, setAudienceType] = useState<"all" | "tag">("all");
  const [selectedTag, setSelectedTag] = useState("");
  const [scheduleType, setScheduleType] = useState<"now" | "scheduled">(
    initialData?.scheduled_at ? "scheduled" : "now",
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toDatetimeLocal(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  useEffect(() => {
    if (!initialData) return;

    setName(initialData.name);
    setTemplateId(initialData.template_id);
    setScheduleType(initialData.scheduled_at ? "scheduled" : "now");
    setScheduledAt(
      initialData.scheduled_at
        ? toDatetimeLocal(initialData.scheduled_at)
        : "",
    );

    const tagCondition = initialData.segment.conditions.find((condition) =>
      condition.field === "tag"
      && condition.operator === "has"
      && typeof condition.value === "string",
    );

    if (initialData.segment.conditions.length === 0) {
      setAudienceType("all");
      setSelectedTag("");
    } else if (tagCondition) {
      setAudienceType("tag");
      setSelectedTag(String(tagCondition.value));
    }
  }, [initialData]);

  useEffect(() => {
    const client = createApiClient(apiUrl);

    client.packages.list(accountId).then((result) => {
      if (result.ok) {
        const rows = result.value as Array<{ id: string; name: string }>;
        setPackages(rows.map((row) => ({ id: row.id, name: row.name })));
      }
    }).catch(() => undefined);

    client.variables.options(accountId).then((result) => {
      if (!result.ok) return;
      const payload = result.value as {
        tags?: Array<{ token: string }>;
      };
      const resolvedTags = (payload.tags ?? [])
        .map((item) => {
          const match = item.token.match(/^\{\{tag:(.+)\}\}$/);
          return match ? { name: match[1] } : null;
        })
        .filter((item): item is TagOption => item !== null);
      setTags(resolvedTags);
    }).catch(() => undefined);
  }, [accountId, apiUrl]);

  const selectedPackageName = useMemo(
    () => packages.find((pkg) => pkg.id === templateId)?.name ?? "",
    [packages, templateId],
  );

  function buildSegment(): SegmentFilter {
    if (audienceType === "tag" && selectedTag) {
      return {
        logic: "and",
        conditions: [
          {
            field: "tag",
            operator: "has",
            value: selectedTag,
          },
        ],
      };
    }

    return {
      logic: "and",
      conditions: [],
    };
  }

  function toUnixEpoch(value: string): number | null {
    if (!value) return null;
    return Math.floor(new Date(value).getTime() / 1000);
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.broadcasts.preview(accountId, {
      segment: buildSegment(),
      page: 1,
      limit: 20,
    });
    if (result.ok) {
      setPreview(result.value as BroadcastPreview);
    } else {
      setError(result.error.message);
    }
    setPreviewLoading(false);
  }

  async function handleSubmit(mode: SubmitMode) {
    setError(null);

    if (!name.trim()) {
      setError("配信名を入力してください");
      return;
    }
    if (!templateId) {
      setError("送信するパッケージを選択してください");
      return;
    }
    if (audienceType === "tag" && !selectedTag) {
      setError("タグを選択してください");
      return;
    }
    if (scheduleType === "scheduled" && !scheduledAt) {
      setError("配信日時を入力してください");
      return;
    }

    await onSubmit({
      id: initialData?.id,
      name: name.trim(),
      template_id: templateId,
      segment: buildSegment(),
      scheduled_at: scheduleType === "scheduled" ? toUnixEpoch(scheduledAt) : null,
      status: initialData?.status,
    }, mode);
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">基本設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="broadcast-name">配信名</Label>
            <Input id="broadcast-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="broadcast-package">送るパッケージ</Label>
            <Select id="broadcast-package" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">パッケージを選択</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
              ))}
            </Select>
            {selectedPackageName && (
              <p className="text-xs text-muted-foreground">選択中: {selectedPackageName}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">配信対象</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                audienceType === "all"
                  ? "border-steel-500 bg-steel-50"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              onClick={() => setAudienceType("all")}
            >
              <div className="font-medium text-cobalt-700">すべてのユーザー</div>
              <p className="mt-1 text-sm text-muted-foreground">条件なしで一斉配信します。</p>
            </button>

            <button
              type="button"
              className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                audienceType === "tag"
                  ? "border-steel-500 bg-steel-50"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              onClick={() => setAudienceType("tag")}
            >
              <div className="font-medium text-cobalt-700">タグで絞り込む</div>
              <p className="mt-1 text-sm text-muted-foreground">特定タグが付いたユーザーだけに配信します。</p>
            </button>
          </div>

          {audienceType === "tag" && (
            <div className="space-y-2">
              <Label htmlFor="broadcast-tag">タグ</Label>
              <Select id="broadcast-tag" value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)}>
                <option value="">タグを選択</option>
                {tags.map((tag) => (
                  <option key={tag.name} value={tag.name}>{tag.name}</option>
                ))}
              </Select>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-cobalt-700">配信対象者数</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  ウィンドウ有効ユーザーと配信除外条件を反映した件数です。
                </p>
              </div>
              <Button type="button" variant="outline" onClick={handlePreview} disabled={previewLoading}>
                {previewLoading ? "確認中..." : "対象者を確認"}
              </Button>
            </div>

            {preview && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs text-muted-foreground">配信対象</div>
                  <div className="mt-1 text-2xl font-semibold text-cobalt-700">{preview.total_recipients}</div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs text-muted-foreground">ウィンドウ外除外</div>
                  <div className="mt-1 text-2xl font-semibold">{preview.excluded_no_window}</div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs text-muted-foreground">無反応除外</div>
                  <div className="mt-1 text-2xl font-semibold">{preview.excluded_no_response}</div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">配信タイミング</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                scheduleType === "now"
                  ? "border-steel-500 bg-steel-50"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              onClick={() => setScheduleType("now")}
            >
              <div className="font-medium text-cobalt-700">今すぐ配信</div>
              <p className="mt-1 text-sm text-muted-foreground">保存後すぐに配信処理を開始します。</p>
            </button>

            <button
              type="button"
              className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                scheduleType === "scheduled"
                  ? "border-steel-500 bg-steel-50"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              onClick={() => setScheduleType("scheduled")}
            >
              <div className="font-medium text-cobalt-700">配信日時を選択</div>
              <p className="mt-1 text-sm text-muted-foreground">指定日時に配信します。</p>
            </button>
          </div>

          {scheduleType === "scheduled" && (
            <div className="space-y-2">
              <Label htmlFor="broadcast-scheduled-at">配信日時</Label>
              <input
                id="broadcast-scheduled-at"
                type="datetime-local"
                step="60"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={loading} onClick={() => void handleSubmit("draft")}>
          一時保存
        </Button>
        <Button type="button" disabled={loading} onClick={() => void handleSubmit("publish")}>
          {scheduleType === "scheduled" ? "登録する" : "今すぐ配信する"}
        </Button>
        {initialData?.id && (
          <a href="./report">
            <Button type="button" variant="secondary">レポートを見る</Button>
          </a>
        )}
      </div>
    </div>
  );
}
