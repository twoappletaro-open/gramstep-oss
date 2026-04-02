"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createApiClient, getApiUrl } from "../../../../../lib/api-client";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "../../../../../components/ui/card";
import { Select } from "../../../../../components/ui/select";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../../../../../components/ui/dialog";

interface CampaignEntry {
  id: string;
  campaign_id: string;
  ig_user_id: string;
  source_trigger_id: string | null;
  source_comment_id: string | null;
  source_comment_created_at: number | null;
  result: string;
  result_reason: string | null;
  selected_at: number | null;
  created_at: number;
}

interface CampaignInfo {
  id: string;
  name: string;
  kind: string;
  status: string;
  selection_method: string | null;
  winner_limit: number | null;
  version: number;
  entries_summary: {
    total: number;
    pending: number;
    win: number;
    lose: number;
    duplicate: number;
    ineligible: number;
  };
}

function resultBadgeVariant(result: string): "default" | "secondary" | "outline" | "destructive" {
  switch (result) {
    case "win": return "default";
    case "lose": return "destructive";
    case "pending": return "secondary";
    case "duplicate": return "outline";
    case "ineligible": return "outline";
    default: return "secondary";
  }
}

function resultLabel(result: string, t: ReturnType<typeof useTranslations>): string {
  switch (result) {
    case "win": return t("entriesWin");
    case "lose": return t("entriesLose");
    case "pending": return t("entriesPending");
    case "duplicate": return t("entriesDuplicate");
    case "ineligible": return t("entriesIneligible");
    default: return result;
  }
}

export default function CampaignEntriesPage() {
  const t = useTranslations("campaigns");
  const tCommon = useTranslations("common");
  const params = useParams();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [resultFilter, setResultFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Manual selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Draw dialog
  const [drawDialog, setDrawDialog] = useState(false);
  // Select winners dialog
  const [selectDialog, setSelectDialog] = useState(false);

  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";
  const limit = 50;

  const loadCampaign = useCallback(async () => {
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.get(campaignId, accountId);
    if (result.ok) {
      setCampaign(result.value as CampaignInfo);
    }
  }, [apiUrl, campaignId, accountId]);

  const loadEntries = useCallback(async () => {
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.entries(campaignId, accountId, {
      page,
      limit,
      result: resultFilter || undefined,
    });
    if (result.ok) {
      const data = result.value as { data: CampaignEntry[]; total: number };
      setEntries(data.data);
      setTotal(data.total);
    } else {
      setError(result.error.message);
    }
  }, [apiUrl, campaignId, accountId, page, resultFilter]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([loadCampaign(), loadEntries()]);
      setLoading(false);
    }
    void load();
  }, [loadCampaign, loadEntries]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const isSelectionPending = campaign?.status === "selection_pending";
  const isDrawing = campaign?.status === "drawing";
  const isDeferred = campaign?.kind === "deferred_lottery";

  function toggleSelect(igUserId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(igUserId)) {
        next.delete(igUserId);
      } else {
        next.add(igUserId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    const pendingEntries = entries.filter((e) => e.result === "pending");
    const allSelected = pendingEntries.every((e) => selectedIds.has(e.ig_user_id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const e of pendingEntries) next.delete(e.ig_user_id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const e of pendingEntries) next.add(e.ig_user_id);
        return next;
      });
    }
  }

  async function handleDraw() {
    setActionLoading(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.draw(campaignId, accountId);
    if (result.ok) {
      await loadCampaign();
      await loadEntries();
      setSelectedIds(new Set());
    } else {
      setError(result.error.message);
    }
    setActionLoading(false);
    setDrawDialog(false);
  }

  async function handleSelectWinners() {
    setActionLoading(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.selectWinners(
      campaignId,
      accountId,
      Array.from(selectedIds),
    );
    if (result.ok) {
      setSelectedIds(new Set());
      await loadCampaign();
      await loadEntries();
    } else {
      setError(result.error.message);
    }
    setActionLoading(false);
    setSelectDialog(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted-foreground">{tCommon("loading")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cobalt-700">{t("entriesTitle")}</h1>
          {campaign && (
            <p className="mt-1 text-sm text-muted-foreground">{campaign.name}</p>
          )}
        </div>
        <div className="flex gap-2">
          {isDrawing && isDeferred && (
            <Button onClick={() => setDrawDialog(true)} disabled={actionLoading}>
              {t("drawButton")}
            </Button>
          )}
          {isSelectionPending && selectedIds.size > 0 && (
            <Button onClick={() => setSelectDialog(true)} disabled={actionLoading}>
              {t("selectWinnersButton")} ({t("selectedCount", { count: selectedIds.size })})
            </Button>
          )}
          <a href={`../../../campaigns/${campaignId}`}>
            <Button variant="outline">{tCommon("back")}</Button>
          </a>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Entry Dashboard */}
      {campaign && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t("totalEntries")}</p>
              <p className="text-2xl font-bold">{campaign.entries_summary.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t("winnersCount")}</p>
              <p className="text-2xl font-bold text-powder-600">{campaign.entries_summary.win}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t("losersCount")}</p>
              <p className="text-2xl font-bold text-terra-500">{campaign.entries_summary.lose}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t("pendingCount")}</p>
              <p className="text-2xl font-bold text-warning-500">{campaign.entries_summary.pending}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4 flex items-center gap-4">
        <Select
          value={resultFilter}
          onChange={(e) => { setResultFilter(e.target.value); setPage(1); }}
        >
          <option value="">{t("allResults")}</option>
          <option value="pending">{t("entriesPending")}</option>
          <option value="win">{t("entriesWin")}</option>
          <option value="lose">{t("entriesLose")}</option>
          <option value="duplicate">{t("entriesDuplicate")}</option>
          <option value="ineligible">{t("entriesIneligible")}</option>
        </Select>
        <span className="text-sm text-muted-foreground">
          {total} {t("entries")}
        </span>
      </div>

      {/* Entries table */}
      {entries.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {t("noEntries")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  {isSelectionPending && (
                    <th className="p-3 w-10">
                      <input
                        type="checkbox"
                        onChange={toggleSelectAll}
                        checked={
                          entries.filter((e) => e.result === "pending").length > 0 &&
                          entries.filter((e) => e.result === "pending").every((e) => selectedIds.has(e.ig_user_id))
                        }
                      />
                    </th>
                  )}
                  <th className="p-3">{t("igUserId")}</th>
                  <th className="p-3">{t("result")}</th>
                  <th className="p-3">{t("selectedAt")}</th>
                  <th className="p-3">{t("entryCreatedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/50">
                    {isSelectionPending && (
                      <td className="p-3">
                        {entry.result === "pending" && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.ig_user_id)}
                            onChange={() => toggleSelect(entry.ig_user_id)}
                          />
                        )}
                      </td>
                    )}
                    <td className="p-3 font-mono text-sm">{entry.ig_user_id}</td>
                    <td className="p-3">
                      <Badge variant={resultBadgeVariant(entry.result)}>
                        {resultLabel(entry.result, t)}
                      </Badge>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {entry.selected_at
                        ? new Date(entry.selected_at * 1000).toLocaleString()
                        : "---"}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {new Date(entry.created_at * 1000).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
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

      {/* Draw confirmation dialog */}
      <Dialog open={drawDialog} onOpenChange={(open) => !open && setDrawDialog(false)}>
        <DialogHeader>
          <DialogTitle>{t("drawConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{t("drawConfirmMessage", { name: campaign?.name ?? "" })}</p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDrawDialog(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleDraw} disabled={actionLoading}>
            {actionLoading ? tCommon("loading") : t("drawButton")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Select winners confirmation dialog */}
      <Dialog open={selectDialog} onOpenChange={(open) => !open && setSelectDialog(false)}>
        <DialogHeader>
          <DialogTitle>{t("selectWinnersConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{t("selectWinnersConfirmMessage", { count: selectedIds.size })}</p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSelectDialog(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSelectWinners} disabled={actionLoading}>
            {actionLoading ? tCommon("loading") : t("selectWinnersButton")}
          </Button>
        </DialogFooter>
      </Dialog>
    </main>
  );
}
