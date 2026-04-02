"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Button } from "../ui/button";
import { createApiClient, getApiUrl } from "../../lib/api-client";

type BroadcastDetail = {
  id: string;
  name: string;
  template_name: string | null;
  status: string;
};

type PreviewResult = {
  total_matched: number;
  total_recipients: number;
  excluded_no_window: number;
  excluded_no_response: number;
  page: number;
  limit: number;
  users: Array<{
    id: string;
    ig_username: string | null;
    display_name: string | null;
    follower_status: string;
  }>;
};

export function BroadcastReport({
  accountId,
  broadcastId,
}: {
  accountId: string;
  broadcastId: string;
}) {
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const [broadcast, setBroadcast] = useState<BroadcastDetail | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const client = createApiClient(apiUrl);
    const [broadcastResult, previewResult] = await Promise.all([
      client.broadcasts.get(broadcastId, accountId),
      client.broadcasts.recipients(broadcastId, accountId, { page, limit }),
    ]);

    if (broadcastResult.ok) {
      setBroadcast(broadcastResult.value as BroadcastDetail);
    }
    if (previewResult.ok) {
      setPreview(previewResult.value as PreviewResult);
    }

    setLoading(false);
  }, [accountId, apiUrl, broadcastId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-muted-foreground">読み込み中...</p>;
  }

  if (!broadcast || !preview) {
    return <p className="text-destructive">レポートを読み込めませんでした。</p>;
  }

  const totalPages = Math.max(Math.ceil(preview.total_recipients / preview.limit), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cobalt-700">一斉配信レポート</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {broadcast.name} / {broadcast.template_name ?? "---"}
          </p>
        </div>
        <a href="..">
          <Button variant="outline">設定へ戻る</Button>
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">配信対象</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-cobalt-700">{preview.total_recipients}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">条件一致</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{preview.total_matched}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ウィンドウ外除外</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{preview.excluded_no_window}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">無反応除外</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{preview.excluded_no_response}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">配信対象ユーザー</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>表示名</TableHead>
                <TableHead>ユーザー名</TableHead>
                <TableHead>フォロー状態</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.display_name ?? "---"}</TableCell>
                  <TableCell>{user.ig_username ?? "---"}</TableCell>
                  <TableCell>{user.follower_status}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{user.id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
            >
              前へ
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
            <Button
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
            >
              次へ
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
