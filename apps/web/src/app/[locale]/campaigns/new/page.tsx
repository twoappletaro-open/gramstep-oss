"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select } from "../../../../components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "../../../../components/ui/card";
import type { CreateCampaignInput, SegmentFilter } from "@gramstep/shared";

type CampaignKind = "scheduled_dm" | "instant_win" | "deferred_lottery";

export default function NewCampaignPage() {
  const t = useTranslations("campaigns");
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<CampaignKind>("scheduled_dm");
  const [name, setName] = useState("");
  const [messageTemplateId, setMessageTemplateId] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [entryStartAt, setEntryStartAt] = useState("");
  const [entryEndAt, setEntryEndAt] = useState("");
  const [selectionMethod, setSelectionMethod] = useState<"random" | "manual">("random");
  const [winProbability, setWinProbability] = useState("100");
  const [winnerLimit, setWinnerLimit] = useState("");
  const [winnerTemplateId, setWinnerTemplateId] = useState("");
  const [loserTemplateId, setLoserTemplateId] = useState("");
  const [duplicateAction, setDuplicateAction] = useState<"ignore" | "send_message">("ignore");

  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  function toUnixEpoch(datetimeLocal: string): number | null {
    if (!datetimeLocal) return null;
    return Math.floor(new Date(datetimeLocal).getTime() / 1000);
  }

  function parseAudienceFilter(): SegmentFilter | null | "INVALID" {
    if (!audienceFilter.trim()) return null;
    try {
      return JSON.parse(audienceFilter) as SegmentFilter;
    } catch {
      return "INVALID";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("nameRequired"));
      return;
    }

    const parsedFilter = parseAudienceFilter();
    if (parsedFilter === "INVALID") {
      setError(t("audienceFilterInvalid"));
      return;
    }

    setLoading(true);
    setError(null);

    const input: CreateCampaignInput = {
      name: name.trim(),
      kind,
      audience_filter: parsedFilter,
      message_template_id: messageTemplateId || null,
      scheduled_at: kind === "scheduled_dm" ? toUnixEpoch(scheduledAt) : null,
      entry_start_at: kind !== "scheduled_dm" ? toUnixEpoch(entryStartAt) : null,
      entry_end_at: kind !== "scheduled_dm" ? toUnixEpoch(entryEndAt) : null,
      selection_method: kind !== "scheduled_dm" ? selectionMethod : null,
      win_probability: kind !== "scheduled_dm" && winProbability ? Number(winProbability) : null,
      winner_limit: kind !== "scheduled_dm" && winnerLimit ? Number(winnerLimit) : null,
      winner_template_id: kind !== "scheduled_dm" && winnerTemplateId ? winnerTemplateId : null,
      loser_template_id: kind !== "scheduled_dm" && loserTemplateId ? loserTemplateId : null,
      winner_actions: [],
      loser_actions: [],
      entry_confirm_enabled: false,
      entry_confirm_template_id: null,
      duplicate_action: kind !== "scheduled_dm" ? duplicateAction : "ignore",
    };

    const client = createApiClient(apiUrl);
    const result = await client.campaigns.create(accountId, input);
    if (result.ok) {
      window.location.href = "../campaigns";
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }

  const isLottery = kind === "instant_win" || kind === "deferred_lottery";

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">{t("createTitle")}</h1>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("basicSettings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("kind")}</Label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as CampaignKind)}>
                <option value="scheduled_dm">{t("kindScheduledDm")}</option>
                <option value="instant_win">{t("kindInstantWin")}</option>
                <option value="deferred_lottery">{t("kindDeferredLottery")}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("messageTemplate")}</Label>
              <Input
                value={messageTemplateId}
                onChange={(e) => setMessageTemplateId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("audienceFilter")}</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={audienceFilter}
                onChange={(e) => setAudienceFilter(e.target.value)}
                placeholder='{"tags": ["vip"]}'
              />
            </div>
          </CardContent>
        </Card>

        {kind === "scheduled_dm" && (
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
                <Select
                  value={selectionMethod}
                  onChange={(e) => setSelectionMethod(e.target.value as "random" | "manual")}
                >
                  <option value="random">{t("selectionRandom")}</option>
                  <option value="manual">{t("selectionManual")}</option>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("winProbability")}</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={winProbability}
                    onChange={(e) => setWinProbability(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("winnerLimit")}</Label>
                  <Input
                    type="number"
                    min="1"
                    value={winnerLimit}
                    onChange={(e) => setWinnerLimit(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("winnerTemplate")}</Label>
                  <Input
                    value={winnerTemplateId}
                    onChange={(e) => setWinnerTemplateId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("loserTemplate")}</Label>
                  <Input
                    value={loserTemplateId}
                    onChange={(e) => setLoserTemplateId(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("duplicateAction")}</Label>
                <Select
                  value={duplicateAction}
                  onChange={(e) => setDuplicateAction(e.target.value as "ignore" | "send_message")}
                >
                  <option value="ignore">{t("duplicateIgnore")}</option>
                  <option value="send_message">{t("duplicateSendMessage")}</option>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? tCommon("loading") : tCommon("create")}
          </Button>
          <a href="../campaigns">
            <Button type="button" variant="outline">{tCommon("cancel")}</Button>
          </a>
        </div>
      </form>
    </main>
  );
}
