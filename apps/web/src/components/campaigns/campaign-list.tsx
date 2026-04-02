"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Select } from "../ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../ui/dialog";
import { createApiClient, getApiUrl } from "../../lib/api-client";

type Campaign = {
  id: string;
  name: string;
  kind: string;
  status: string;
  scheduled_at: number | null;
  version: number;
  created_at: number;
  updated_at: number;
};

type ListResponse = {
  data: Campaign[];
  total: number;
  page: number;
  limit: number;
};

const KIND_OPTIONS = ["", "scheduled_dm", "instant_win", "deferred_lottery"] as const;
const STATUS_OPTIONS = ["", "draft", "scheduled", "active", "drawing", "selection_pending", "dispatching", "completed", "cancelled", "paused"] as const;

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "draft":
      return "secondary";
    case "scheduled":
    case "active":
    case "dispatching":
    case "drawing":
      return "default";
    case "completed":
      return "outline";
    case "cancelled":
      return "destructive";
    case "paused":
      return "secondary";
    default:
      return "secondary";
  }
}

function kindLabel(kind: string, t: ReturnType<typeof useTranslations<"campaigns">>): string {
  switch (kind) {
    case "scheduled_dm": return t("kindScheduledDm");
    case "instant_win": return t("kindInstantWin");
    case "deferred_lottery": return t("kindDeferredLottery");
    default: return kind;
  }
}

function statusLabel(status: string, t: ReturnType<typeof useTranslations<"campaigns">>): string {
  const map: Record<string, string> = {
    draft: t("statusDraft"),
    scheduled: t("statusScheduled"),
    active: t("statusActive"),
    drawing: t("statusDrawing"),
    selection_pending: t("statusSelectionPending"),
    dispatching: t("statusDispatching"),
    completed: t("statusCompleted"),
    cancelled: t("statusCancelled"),
    paused: t("statusPaused"),
  };
  return map[status] ?? status;
}

export function CampaignList({ accountId }: { accountId: string }) {
  const t = useTranslations("campaigns");
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await client.campaigns.list(accountId, {
      page,
      limit,
      kind: kindFilter || undefined,
      status: statusFilter || undefined,
    });
    if (result.ok) {
      const resp = result.value as ListResponse;
      setCampaigns(resp.data);
      setTotal(resp.total);
    }
    setLoading(false);
  }, [accountId, page, limit, kindFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await client.campaigns.delete(deleteTarget.id);
    if (result.ok) {
      setCampaigns((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setTotal((prev) => prev - 1);
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
        <a href="./campaigns/new">
          <Button>{t("create")}</Button>
        </a>
      </div>

      <div className="flex gap-3">
        <Select
          value={kindFilter}
          onChange={(e) => { setKindFilter(e.target.value); setPage(1); }}
          className="w-48"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k === "" ? t("allKinds") : kindLabel(k, t)}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="w-48"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "" ? t("allStatuses") : statusLabel(s, t)}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
      ) : campaigns.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-muted-foreground" data-testid="empty-state">
            {t("empty")}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("kind")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("createdAt")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <a href={`${pathname}/${c.id}`} className="font-medium text-cobalt-700 hover:text-steel-500 transition-colors">
                      {c.name}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{kindLabel(c.kind, t)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={statusBadgeVariant(c.status)}
                      className={c.status === "paused" ? "text-warning-500" : undefined}
                    >
                      {statusLabel(c.status, t)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(c.created_at * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <a href={`${pathname}/${c.id}`}>
                      <Button variant="ghost" size="sm">{tCommon("edit")}</Button>
                    </a>
                    {(c.status === "draft" || c.status === "cancelled") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeleteTarget(c)}
                      >
                        {tCommon("delete")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t("prevPage")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("nextPage")}
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{t("deleteConfirmMessage", { name: deleteTarget?.name ?? "" })}</p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            {tCommon("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? tCommon("loading") : tCommon("delete")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
