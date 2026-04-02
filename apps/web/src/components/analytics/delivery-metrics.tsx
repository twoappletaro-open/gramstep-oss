"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select } from "../ui/select";
import { Badge } from "../ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import type { DeliveryMetricsResponse } from "../../lib/api-client";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function DeliveryMetrics({ accountId }: { accountId: string }) {
  const t = useTranslations("analytics");
  const tCommon = useTranslations("common");
  const [metrics, setMetrics] = useState<DeliveryMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30d");
  const [error, setError] = useState<string | null>(null);

  const apiUrl =
    typeof window !== "undefined"
      ? (getApiUrl())
      : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await client.analytics.delivery(accountId, { period });
    if (result.ok) {
      setMetrics(result.value);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [accountId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-center py-8">{tCommon("loading")}</p>;
  }

  if (error || !metrics) {
    return <p className="text-center py-8 text-destructive">{error ?? tCommon("error")}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium">{t("period")}</label>
        <Select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="7d">{t("period7d")}</option>
          <option value="30d">{t("period30d")}</option>
          <option value="90d">{t("period90d")}</option>
        </Select>
      </div>

      {/* Summary KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("totalSent")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.total_sent.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("readRate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercent(metrics.read_rate)}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.total_read.toLocaleString()} / {metrics.total_sent.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("clickRate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercent(metrics.click_rate)}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.click_count.toLocaleString()} {t("clickCount")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("cvEventCount")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.cv_event_count.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Rate cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("windowValidityRate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercent(metrics.window_validity_rate)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("scenarioCompletionRate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercent(metrics.scenario_completion_rate)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("windowExpiryDropoutRate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercent(metrics.window_expiry_dropout_rate)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Daily trend table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("deliveryTrend")}</CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.daily_stats.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground">--</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("date")}</TableHead>
                  <TableHead className="text-right">{t("sent")}</TableHead>
                  <TableHead className="text-right">{t("delivered")}</TableHead>
                  <TableHead className="text-right">{t("read")}</TableHead>
                  <TableHead className="text-right">{t("failed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.daily_stats.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>{row.date}</TableCell>
                    <TableCell className="text-right">{row.sent.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{row.delivered.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{row.read.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <span className={row.failed > 0 ? "text-destructive" : ""}>
                        {row.failed.toLocaleString()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
