"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { createApiClient, getApiUrl } from "../../lib/api-client";

type SurveyListItem = {
  id: string;
  name: string;
  is_active: boolean;
  archived_at: number | null;
  created_at: number;
  response_user_count: number;
};

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("ja-JP");
}

export function SurveyList({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "ja";
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const client = createApiClient(apiUrl);

  const [surveys, setSurveys] = useState<SurveyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<SurveyListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const allSelected = useMemo(() => (
    surveys.length > 0 && selectedIds.length === surveys.length
  ), [selectedIds, surveys]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await client.surveys.list(accountId, includeArchived);
    if (result.ok) {
      setSurveys(result.value as SurveyListItem[]);
    }
    setLoading(false);
  }, [accountId, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((current) => current !== id) : [...prev, id]);
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : surveys.map((survey) => survey.id));
  }

  async function handleArchiveSelected() {
    if (selectedIds.length === 0) return;
    const result = await client.surveys.archive(accountId, selectedIds);
    if (result.ok) {
      setSelectedIds([]);
      await load();
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await client.surveys.delete(deleteTarget.id);
    if (result.ok) {
      setSurveys((prev) => prev.filter((survey) => survey.id !== deleteTarget.id));
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  async function handleExport(id: string, name: string) {
    const result = await client.surveys.exportCsv(accountId, id);
    if (!result.ok) return;

    const blob = new Blob([result.value], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cobalt-700">アンケート</h1>
          <p className="text-sm text-muted-foreground mt-1">ボタンやトリガーから開始できる質問フローを管理します。</p>
        </div>
        <Link href={`/${locale}/surveys/new`}>
          <Button>アンケートを作成</Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          アーカイブを表示
        </label>
        <Button type="button" variant="outline" onClick={handleArchiveSelected} disabled={selectedIds.length === 0}>
          選択をアーカイブ
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center">読み込み中...</p>
      ) : surveys.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-muted-foreground">アンケートはまだありません。</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </TableHead>
              <TableHead>名前</TableHead>
              <TableHead>回答ユーザー数</TableHead>
              <TableHead>有効ステータス</TableHead>
              <TableHead>作成日時</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {surveys.map((survey) => (
              <TableRow key={survey.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(survey.id)}
                    onChange={() => toggleSelected(survey.id)}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`/${locale}/surveys/${survey.id}`} className="font-medium text-cobalt-700 hover:text-steel-500 transition-colors">
                    {survey.name}
                  </Link>
                </TableCell>
                <TableCell>{survey.response_user_count}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Badge variant={survey.is_active ? "default" : "secondary"}>
                      {survey.is_active ? "有効" : "無効"}
                    </Badge>
                    {survey.archived_at && <Badge variant="secondary">アーカイブ</Badge>}
                  </div>
                </TableCell>
                <TableCell>{formatDate(survey.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/${locale}/surveys/${survey.id}/report`}>
                    <Button variant="ghost" size="sm">レポート</Button>
                  </Link>
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleExport(survey.id, survey.name)}>
                    CSV
                  </Button>
                  <Link href={`/${locale}/surveys/${survey.id}`}>
                    <Button variant="ghost" size="sm">編集</Button>
                  </Link>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(survey)}>
                    削除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>アンケートを削除</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{deleteTarget?.name ?? ""} を削除します。この操作は元に戻せません。</p>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>キャンセル</Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={handleDelete}>
            {deleting ? "削除中..." : "削除"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
