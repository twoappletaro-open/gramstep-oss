"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { createApiClient, getApiUrl } from "../../lib/api-client";

type SegmentFilter = {
  logic: "and" | "or";
  conditions: Array<{
    field: string;
    operator: string;
    value: string | number;
  }>;
};

type BroadcastItem = {
  id: string;
  name: string;
  template_name: string | null;
  segment: SegmentFilter;
  status: string;
  scheduled_at: number | null;
  total_recipients: number;
  created_at: number;
};

function formatAudience(segment: SegmentFilter): string {
  if (!segment.conditions.length) {
    return "すべてのユーザー";
  }

  const tagCondition = segment.conditions.find((condition) =>
    condition.field === "tag" && condition.operator === "has",
  );
  if (tagCondition && typeof tagCondition.value === "string") {
    return `タグ: ${tagCondition.value}`;
  }

  return "条件あり";
}

function formatStatus(status: string): string {
  switch (status) {
    case "draft":
      return "下書き";
    case "scheduled":
      return "予約済み";
    case "sending":
      return "配信中";
    case "completed":
      return "完了";
    case "cancelled":
      return "キャンセル";
    default:
      return status;
  }
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "---";
  return new Date(timestamp * 1000).toLocaleString("ja-JP");
}

export function BroadcastList({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const client = createApiClient(apiUrl);
    const result = await client.broadcasts.list(accountId);
    if (result.ok) {
      setItems(result.value as BroadcastItem[]);
    }
    setLoading(false);
  }, [accountId, apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cobalt-700">一斉配信</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            パッケージを選び、配信対象とタイミングを指定して一斉配信できます。
          </p>
        </div>
        <a href={`${pathname}/new`}>
          <Button>新規作成</Button>
        </a>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted-foreground">読み込み中...</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-muted-foreground">一斉配信はまだありません。</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>配信名</TableHead>
                <TableHead>対象</TableHead>
                <TableHead>パッケージ</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>配信日時</TableHead>
                <TableHead>対象者数</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium text-cobalt-700">{item.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.id}</div>
                  </TableCell>
                  <TableCell>{formatAudience(item.segment)}</TableCell>
                  <TableCell>{item.template_name ?? item.id}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "completed" ? "default" : "secondary"}>
                      {formatStatus(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(item.scheduled_at)}</TableCell>
                  <TableCell>{item.total_recipients}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <a href={`${pathname}/${item.id}`}>
                        <Button variant="ghost" size="sm">編集</Button>
                      </a>
                      <a href={`${pathname}/${item.id}/report`}>
                        <Button variant="outline" size="sm">レポート</Button>
                      </a>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
