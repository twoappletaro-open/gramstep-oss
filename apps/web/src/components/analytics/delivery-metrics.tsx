"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select } from "../ui/select";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { DeliveryTrendChart } from "./delivery-trend-chart";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import type { DeliveryMetricsResponse } from "../../lib/api-client";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

type RangeOption = "7d" | "30d" | "90d" | "custom";

export function DeliveryMetrics({
  accountId,
  locale,
}: {
  accountId: string;
  locale: string;
}) {
  const t = useTranslations("analytics");
  const tCommon = useTranslations("common");
  const [metrics, setMetrics] = useState<DeliveryMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeOption, setRangeOption] = useState<RangeOption>("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState<{ period?: string; date_from?: string; date_to?: string }>({
    period: "30d",
  });
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const apiUrl = useMemo(
    () => (typeof window !== "undefined" ? getApiUrl() : ""),
    [],
  );

  const load = useCallback(async () => {
    if (!accountId || !apiUrl) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.analytics.delivery(accountId, query);
    if (result.ok) {
      setMetrics(result.value);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [accountId, apiUrl, query]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleRangeChange(nextValue: string) {
    const nextRange = nextValue as RangeOption;
    setRangeOption(nextRange);
    setInputError(null);
    if (nextRange !== "custom") {
      setQuery({ period: nextRange });
    }
  }

  function applyCustomRange() {
    if (!dateFrom || !dateTo) {
      setInputError(t("customRangeValidation"));
      return;
    }
    if (dateFrom > dateTo) {
      setInputError(t("customRangeOrderValidation"));
      return;
    }
    setInputError(null);
    setQuery({ date_from: dateFrom, date_to: dateTo });
  }

  if (loading) {
    return <p className="text-center py-8">{tCommon("loading")}</p>;
  }

  if (error || !metrics) {
    return <p className="text-center py-8 text-destructive">{error ?? tCommon("error")}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("period")}</label>
            <Select
              value={rangeOption}
              onChange={(e) => handleRangeChange(e.target.value)}
              className="min-w-40"
            >
              <option value="7d">{t("period7d")}</option>
              <option value="30d">{t("period30d")}</option>
              <option value="90d">{t("period90d")}</option>
              <option value="custom">{t("periodCustom")}</option>
            </Select>
          </div>
          {rangeOption === "custom" ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("startDate")}</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("endDate")}</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <Button onClick={applyCustomRange}>{t("applyCustomRange")}</Button>
            </>
          ) : null}
        </div>
        {inputError ? (
          <p className="text-sm text-destructive">{inputError}</p>
        ) : null}
        {query.date_from && query.date_to ? (
          <p className="text-sm text-muted-foreground">
            {t("customRangeApplied", { dateFrom: query.date_from, dateTo: query.date_to })}
          </p>
        ) : null}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("deliveryTrend")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("deliveryTrendDescription")}
          </p>
        </CardHeader>
        <CardContent>
          <DeliveryTrendChart
            locale={locale}
            stats={metrics.daily_stats}
            height={320}
            labels={{
              visibleMetrics: t("visibleMetrics"),
              rangeSummary: t("rangeSummary"),
              latestDay: t("latestDay"),
              noData: tCommon("error"),
            }}
            series={[
              {
                key: "sent",
                color: "#4D7EA8",
                fillClassName: "bg-steel-500",
                textClassName: "text-steel-600",
                label: t("totalSent"),
              },
              {
                key: "delivered",
                color: "#6BA6C8",
                fillClassName: "bg-sky-400",
                textClassName: "text-sky-600",
                label: t("totalDelivered"),
              },
              {
                key: "read",
                color: "#89C2D9",
                fillClassName: "bg-powder-500",
                textClassName: "text-powder-600",
                label: t("totalRead"),
              },
              {
                key: "failed",
                color: "#D35D6E",
                fillClassName: "bg-rose-400",
                textClassName: "text-rose-600",
                label: t("totalFailed"),
              },
            ]}
          />
        </CardContent>
      </Card>

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
