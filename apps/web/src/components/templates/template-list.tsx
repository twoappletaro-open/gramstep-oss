"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { createApiClient, getApiUrl } from "../../lib/api-client";

type PackageItem = {
  id: string;
  name: string;
  text: string;
  buttons: Array<unknown>;
  is_active: boolean;
  created_at: number;
  updated_at: number;
};

function previewText(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("ja-JP");
}

export function TemplateList({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";

  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const client = createApiClient(apiUrl);
    const result = await client.packages.list(accountId);
    if (result.ok) {
      setPackages(result.value as PackageItem[]);
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
          <h1 className="text-2xl font-bold text-cobalt-700">パッケージ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ボタン付きメッセージを作成し、フォロワー条件ごとに送信先パッケージを切り替えられます。
          </p>
        </div>
        <a href={`${pathname}/new`}>
          <Button>新規作成</Button>
        </a>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted-foreground">読み込み中...</p>
      ) : packages.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-muted-foreground">パッケージはまだありません。</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead>本文プレビュー</TableHead>
                <TableHead>ボタン数</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>更新日時</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {packages.map((pkg) => (
                <TableRow key={pkg.id}>
                  <TableCell>
                    <div className="font-medium text-cobalt-700">{pkg.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{pkg.id}</div>
                  </TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    {previewText(pkg.text)}
                  </TableCell>
                  <TableCell>{pkg.buttons.length}</TableCell>
                  <TableCell>
                    <Badge variant={pkg.is_active ? "default" : "secondary"}>
                      {pkg.is_active ? "有効" : "無効"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(pkg.updated_at)}</TableCell>
                  <TableCell className="text-right">
                    <a href={`${pathname}/${pkg.id}`}>
                      <Button variant="ghost" size="sm">編集</Button>
                    </a>
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
