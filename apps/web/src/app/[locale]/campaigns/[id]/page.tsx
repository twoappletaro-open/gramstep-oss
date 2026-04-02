"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select } from "../../../../components/ui/select";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "../../../../components/ui/card";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../../../../components/ui/dialog";
import type { UpdateCampaignInput, SegmentFilter } from "@gramstep/shared";

interface EntriesSummary {
  total: number;
  pending: number;
  win: number;
  lose: number;
  duplicate: number;
  ineligible: number;
}

interface DispatchesSummary {
  total: number;
  pending: number;
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
  cancelled: number;
}

interface CampaignDetail {
  id: string;
  name: string;
  kind: string;
  status: string;
  audience_filter: SegmentFilter | null;
  message_template_id: string | null;
  scheduled_at: number | null;
  entry_start_at: number | null;
  entry_end_at: number | null;
  selection_method: string | null;
  win_probability: number | null;
  winner_limit: number | null;
  remaining_winner_slots: number | null;
  winner_template_id: string | null;
  loser_template_id: string | null;
  duplicate_action: string;
  version: number;
  created_at: number;
  updated_at: number;
  entries_summary: EntriesSummary;
  dispatches_summary: DispatchesSummary;
}

const CANCELLABLE_STATUSES = ["draft", "scheduled", "active", "drawing", "selection_pending", "dispatching", "paused"];
const EDITABLE_STATUSES = ["draft", "scheduled"];

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "draft": return "secondary";
    case "scheduled": case "active": case "dispatching": case "drawing": return "default";
    case "completed": return "outline";
    case "cancelled": return "destructive";
    case "paused": return "secondary";
    default: return "secondary";
  }
}

function toDatetimeLocal(epoch: number | null): string {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toUnixEpoch(datetimeLocal: string): number | null {
  if (!datetimeLocal) return null;
  return Math.floor(new Date(datetimeLocal).getTime() / 1000);
}

export default function CampaignDetailPage() {
  const t = useTranslations("campaigns");
  const tCommon = useTranslations("common");
  const params = useParams();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [name, setName] = useState("");
  const [messageTemplateId, setMessageTemplateId] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [entryStartAt, setEntryStartAt] = useState("");
  const [entryEndAt, setEntryEndAt] = useState("");
  const [selectionMethod, setSelectionMethod] = useState("random");
  const [winProbability, setWinProbability] = useState("");
  const [winnerLimit, setWinnerLimit] = useState("");
  const [winnerTemplateId, setWinnerTemplateId] = useState("");
  const [loserTemplateId, setLoserTemplateId] = useState("");
  const [duplicateAction, setDuplicateAction] = useState("ignore");

  // Dialogs
  const [cancelDialog, setCancelDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [drawDialog, setDrawDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.campaigns.get(id, accountId);
      if (result.ok) {
        const v = result.value as CampaignDetail;
        setCampaign(v);
        setName(v.name);
        setMessageTemplateId(v.message_template_id ?? "");
        setAudienceFilter(v.audience_filter ? JSON.stringify(v.audience_filter, null, 2) : "");
        setScheduledAt(toDatetimeLocal(v.scheduled_at));
        setEntryStartAt(toDatetimeLocal(v.entry_start_at));
        setEntryEndAt(toDatetimeLocal(v.entry_end_at));
        setSelectionMethod(v.selection_method ?? "random");
        setWinProbability(v.win_probability != null ? String(v.win_probability) : "");
        setWinnerLimit(v.winner_limit != null ? String(v.winner_limit) : "");
        setWinnerTemplateId(v.winner_template_id ?? "");
        setLoserTemplateId(v.loser_template_id ?? "");
        setDuplicateAction(v.duplicate_action ?? "ignore");
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    }
    void load();
  }, [id, apiUrl, accountId]);

  const isEditable = campaign ? EDITABLE_STATUSES.includes(campaign.status) : false;
  const isActiveInstantWin = campaign ? (campaign.status === "active" && campaign.kind === "instant_win") : false;
  const isCancellable = campaign ? CANCELLABLE_STATUSES.includes(campaign.status) : false;
  const isDeletable = campaign ? (campaign.status === "draft" || campaign.status === "cancelled") : false;
  const isLottery = campaign ? (campaign.kind === "instant_win" || campaign.kind === "deferred_lottery") : false;
  const isDeferred = campaign ? campaign.kind === "deferred_lottery" : false;
  const isDrawing = campaign ? campaign.status === "drawing" : false;
  const isSelectionPending = campaign ? campaign.status === "selection_pending" : false;

  function kindLabel(kind: string): string {
    switch (kind) {
      case "scheduled_dm": return t("kindScheduledDm");
      case "instant_win": return t("kindInstantWin");
      case "deferred_lottery": return t("kindDeferredLottery");
      default: return kind;
    }
  }

  function statusLabelText(status: string): string {
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

  function parseAudienceFilter(): SegmentFilter | null | "INVALID" {
    if (!audienceFilter.trim()) return null;
    try {
      return JSON.parse(audienceFilter) as SegmentFilter;
    } catch {
      return "INVALID";
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!campaign) return;

    setSaving(true);
    setError(null);

    let input: UpdateCampaignInput;

    if (isActiveInstantWin) {
      // active instant_win: win_probabilityのみ変更可
      input = {
        version: campaign.version,
        win_probability: winProbability ? Number(winProbability) : null,
      };
    } else {
      const parsedFilter = parseAudienceFilter();
      if (parsedFilter === "INVALID") {
        setError(t("audienceFilterInvalid"));
        setSaving(false);
        return;
      }

      input = {
        version: campaign.version,
        name: name.trim(),
        message_template_id: messageTemplateId || null,
        audience_filter: parsedFilter,
        scheduled_at: campaign.kind === "scheduled_dm" ? toUnixEpoch(scheduledAt) : null,
        entry_start_at: isLottery ? toUnixEpoch(entryStartAt) : null,
        entry_end_at: isLottery ? toUnixEpoch(entryEndAt) : null,
        selection_method: isLottery ? (selectionMethod as "random" | "manual") : null,
        win_probability: isLottery && winProbability ? Number(winProbability) : null,
        winner_limit: isLottery && winnerLimit ? Number(winnerLimit) : null,
        winner_template_id: isLottery && winnerTemplateId ? winnerTemplateId : null,
        loser_template_id: isLottery && loserTemplateId ? loserTemplateId : null,
        duplicate_action: isLottery ? (duplicateAction as "ignore" | "send_message") : "ignore",
      };
    }

    const client = createApiClient(apiUrl);
    const result = await client.campaigns.update(id, input);
    if (result.ok) {
      window.location.href = "../../campaigns";
    } else {
      if (result.error.status === 409) {
        setError(t("versionConflict"));
        await reloadCampaign();
      } else {
        setError(result.error.message);
      }
    }
    setSaving(false);
  }

  async function reloadCampaign() {
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.get(id, accountId);
    if (result.ok) {
      const v = result.value as CampaignDetail;
      setCampaign(v);
      setName(v.name);
      setMessageTemplateId(v.message_template_id ?? "");
      setAudienceFilter(v.audience_filter ? JSON.stringify(v.audience_filter, null, 2) : "");
      setScheduledAt(toDatetimeLocal(v.scheduled_at));
      setEntryStartAt(toDatetimeLocal(v.entry_start_at));
      setEntryEndAt(toDatetimeLocal(v.entry_end_at));
      setSelectionMethod(v.selection_method ?? "random");
      setWinProbability(v.win_probability != null ? String(v.win_probability) : "");
      setWinnerLimit(v.winner_limit != null ? String(v.winner_limit) : "");
      setWinnerTemplateId(v.winner_template_id ?? "");
      setLoserTemplateId(v.loser_template_id ?? "");
      setDuplicateAction(v.duplicate_action ?? "ignore");
    }
  }

  async function handleCancel() {
    if (!campaign) return;
    setActionLoading(true);
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.cancel(id, campaign.version);
    if (result.ok) {
      window.location.reload();
    } else {
      if (result.error.status === 409) {
        setError(t("versionConflict"));
        await reloadCampaign();
      } else {
        setError(result.error.message);
      }
    }
    setActionLoading(false);
    setCancelDialog(false);
  }

  async function handleResume() {
    if (!campaign) return;
    setActionLoading(true);
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.resume(id, campaign.version);
    if (result.ok) {
      window.location.reload();
    } else {
      if (result.error.status === 409) {
        setError(t("versionConflict"));
        await reloadCampaign();
      } else {
        setError(result.error.message);
      }
    }
    setActionLoading(false);
  }

  async function handleDelete() {
    setActionLoading(true);
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.delete(id);
    if (result.ok) {
      window.location.href = "../../campaigns";
    } else {
      setError(result.error.message);
    }
    setActionLoading(false);
    setDeleteDialog(false);
  }

  async function handleDraw() {
    if (!campaign) return;
    setActionLoading(true);
    const client = createApiClient(apiUrl);
    const result = await client.campaigns.draw(id, accountId);
    if (result.ok) {
      window.location.reload();
    } else {
      setError(result.error.message);
    }
    setActionLoading(false);
    setDrawDialog(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-muted-foreground">{tCommon("loading")}</p>
      </main>
    );
  }

  if (!campaign) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-destructive">{error ?? t("notFound")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-cobalt-700">{isEditable ? t("editTitle") : campaign.name}</h1>
        <div className="flex gap-2">
          {isDeferred && isDrawing && (
            <Button onClick={() => setDrawDialog(true)} disabled={actionLoading}>
              {t("drawButton")}
            </Button>
          )}
          {isDeferred && (isDrawing || isSelectionPending) && (
            <a href={`${id}/entries`}>
              <Button variant="outline">{t("viewEntries")}</Button>
            </a>
          )}
          {campaign.status === "paused" && (
            <Button onClick={handleResume} disabled={actionLoading}>
              {t("resumeButton")}
            </Button>
          )}
          {isCancellable && (
            <Button variant="outline" onClick={() => setCancelDialog(true)}>
              {t("cancelButton")}
            </Button>
          )}
          {isDeletable && (
            <Button variant="destructive" onClick={() => setDeleteDialog(true)}>
              {tCommon("delete")}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Status / Meta info */}
      <div className="mb-6 flex flex-wrap gap-4">
        <Badge
          variant={statusBadgeVariant(campaign.status)}
          className={campaign.status === "paused" ? "text-warning-500" : undefined}
        >
          {statusLabelText(campaign.status)}
        </Badge>
        <Badge variant="outline">{kindLabel(campaign.kind)}</Badge>
        <span className="text-sm text-muted-foreground">
          {t("version")}: {campaign.version}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("createdAt")}: {new Date(campaign.created_at * 1000).toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("updatedAt")}: {new Date(campaign.updated_at * 1000).toLocaleString()}
        </span>
      </div>

      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("dispatches")}</p>
            <p className="text-2xl font-bold">{campaign.dispatches_summary.total}</p>
            <div className="mt-1 text-xs text-muted-foreground">
              {t("dispatchesSent")}: {campaign.dispatches_summary.sent} / {t("dispatchesFailed")}: {campaign.dispatches_summary.failed}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("dispatchesPending")}</p>
            <p className="text-2xl font-bold">{campaign.dispatches_summary.pending + campaign.dispatches_summary.queued}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("dispatchesSkipped")}</p>
            <p className="text-2xl font-bold">{campaign.dispatches_summary.skipped}</p>
          </CardContent>
        </Card>
        {isLottery && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t("entries")}</p>
              <p className="text-2xl font-bold">{campaign.entries_summary.total}</p>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("entriesWin")}: {campaign.entries_summary.win} / {t("entriesLose")}: {campaign.entries_summary.lose}
              </div>
            </CardContent>
          </Card>
        )}
        {campaign.kind === "instant_win" && campaign.remaining_winner_slots != null && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t("remainingWinnerSlots")}</p>
              <p className="text-2xl font-bold">{campaign.remaining_winner_slots}</p>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("winnerLimit")}: {campaign.winner_limit ?? "---"}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Entries link for lottery campaigns */}
      {isLottery && campaign.entries_summary.total > 0 && (
        <div className="mb-6">
          <a href={`${id}/entries`}>
            <Button variant="outline" size="sm">{t("viewEntries")} ({campaign.entries_summary.total})</Button>
          </a>
        </div>
      )}

      {/* Edit form or read-only view */}
      {isActiveInstantWin ? (
        /* Active instant_win: win_probabilityのみ編集可 + 他は読み取り専用 */
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("basicSettings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">{t("name")}</p>
                <p className="font-medium">{campaign.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("messageTemplate")}</p>
                <p className="font-medium">{campaign.message_template_id ?? "---"}</p>
              </div>
              {campaign.audience_filter && (
                <div>
                  <p className="text-sm text-muted-foreground">{t("audienceFilter")}</p>
                  <pre className="mt-1 rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(campaign.audience_filter, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("lotterySettings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {campaign.entry_start_at && campaign.entry_end_at && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("entryStartAt")}</p>
                    <p className="font-medium">{new Date(campaign.entry_start_at * 1000).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("entryEndAt")}</p>
                    <p className="font-medium">{new Date(campaign.entry_end_at * 1000).toLocaleString()}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("selectionMethod")}</p>
                  <p className="font-medium">
                    {campaign.selection_method === "random" ? t("selectionRandom") : t("selectionManual")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("duplicateAction")}</p>
                  <p className="font-medium">
                    {campaign.duplicate_action === "ignore" ? t("duplicateIgnore") : t("duplicateSendMessage")}
                  </p>
                </div>
              </div>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("winProbability")}</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={winProbability}
                    onChange={(e) => setWinProbability(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("winProbabilityActiveHelp")}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("winnerLimit")}</p>
                    <p className="font-medium">{campaign.winner_limit ?? "---"}</p>
                    <p className="text-xs text-muted-foreground">{t("winnerLimitLocked")}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("winnerTemplate")}</p>
                    <p className="font-medium">{campaign.winner_template_id ?? "---"}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("loserTemplate")}</p>
                  <p className="font-medium">{campaign.loser_template_id ?? "---"}</p>
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? tCommon("loading") : tCommon("save")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <a href="../../campaigns">
            <Button variant="outline">{tCommon("back")}</Button>
          </a>
        </div>
      ) : isEditable ? (
        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("basicSettings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("name")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>{t("messageTemplate")}</Label>
                <Input value={messageTemplateId} onChange={(e) => setMessageTemplateId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("audienceFilter")}</Label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={audienceFilter}
                  onChange={(e) => setAudienceFilter(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {campaign.kind === "scheduled_dm" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("scheduledDmSettings")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("scheduledAt")}</Label>
                  <input
                    type="datetime-local"
                    step="300"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("scheduledAtHelp")}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {isLottery && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("lotterySettings")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("entryStartAt")}</Label>
                    <input
                      type="datetime-local"
                      step="300"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={entryStartAt}
                      onChange={(e) => setEntryStartAt(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("entryEndAt")}</Label>
                    <input
                      type="datetime-local"
                      step="300"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={entryEndAt}
                      onChange={(e) => setEntryEndAt(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("selectionMethod")}</Label>
                  <Select value={selectionMethod} onChange={(e) => setSelectionMethod(e.target.value)}>
                    <option value="random">{t("selectionRandom")}</option>
                    <option value="manual">{t("selectionManual")}</option>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("winProbability")}</Label>
                    <Input type="number" min="0" max="100" value={winProbability} onChange={(e) => setWinProbability(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("winnerLimit")}</Label>
                    <Input type="number" min="1" value={winnerLimit} onChange={(e) => setWinnerLimit(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("winnerTemplate")}</Label>
                    <Input value={winnerTemplateId} onChange={(e) => setWinnerTemplateId(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("loserTemplate")}</Label>
                    <Input value={loserTemplateId} onChange={(e) => setLoserTemplateId(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("duplicateAction")}</Label>
                  <Select value={duplicateAction} onChange={(e) => setDuplicateAction(e.target.value)}>
                    <option value="ignore">{t("duplicateIgnore")}</option>
                    <option value="send_message">{t("duplicateSendMessage")}</option>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? tCommon("loading") : tCommon("save")}
            </Button>
            <a href="../../campaigns">
              <Button type="button" variant="outline">{tCommon("back")}</Button>
            </a>
          </div>
        </form>
      ) : (
        /* Read-only view for non-editable campaigns */
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("basicSettings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">{t("name")}</p>
                <p className="font-medium">{campaign.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("messageTemplate")}</p>
                <p className="font-medium">{campaign.message_template_id ?? "---"}</p>
              </div>
              {campaign.audience_filter && (
                <div>
                  <p className="text-sm text-muted-foreground">{t("audienceFilter")}</p>
                  <pre className="mt-1 rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(campaign.audience_filter, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {campaign.kind === "scheduled_dm" && campaign.scheduled_at && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("scheduledDmSettings")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t("scheduledAt")}</p>
                <p className="font-medium">{new Date(campaign.scheduled_at * 1000).toLocaleString()}</p>
              </CardContent>
            </Card>
          )}

          {isLottery && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("lotterySettings")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {campaign.entry_start_at && campaign.entry_end_at && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("entryStartAt")}</p>
                      <p className="font-medium">{new Date(campaign.entry_start_at * 1000).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("entryEndAt")}</p>
                      <p className="font-medium">{new Date(campaign.entry_end_at * 1000).toLocaleString()}</p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("selectionMethod")}</p>
                    <p className="font-medium">
                      {campaign.selection_method === "random" ? t("selectionRandom") : t("selectionManual")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("winProbability")}</p>
                    <p className="font-medium">{campaign.win_probability ?? "---"}%</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("winnerLimit")}</p>
                    <p className="font-medium">{campaign.winner_limit ?? "---"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("duplicateAction")}</p>
                    <p className="font-medium">
                      {campaign.duplicate_action === "ignore" ? t("duplicateIgnore") : t("duplicateSendMessage")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <a href="../../campaigns">
            <Button variant="outline">{tCommon("back")}</Button>
          </a>
        </div>
      )}

      {/* Cancel confirmation dialog */}
      <Dialog open={cancelDialog} onOpenChange={(open) => !open && setCancelDialog(false)}>
        <DialogHeader>
          <DialogTitle>{t("cancelConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{t("cancelConfirmMessage", { name: campaign.name })}</p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCancelDialog(false)}>
            {tCommon("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={actionLoading}>
            {actionLoading ? tCommon("loading") : tCommon("confirm")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialog} onOpenChange={(open) => !open && setDeleteDialog(false)}>
        <DialogHeader>
          <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{t("deleteConfirmMessage", { name: campaign.name })}</p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteDialog(false)}>
            {tCommon("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={actionLoading}>
            {actionLoading ? tCommon("loading") : tCommon("delete")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Draw confirmation dialog */}
      <Dialog open={drawDialog} onOpenChange={(open) => !open && setDrawDialog(false)}>
        <DialogHeader>
          <DialogTitle>{t("drawConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{t("drawConfirmMessage", { name: campaign.name })}</p>
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
    </main>
  );
}
