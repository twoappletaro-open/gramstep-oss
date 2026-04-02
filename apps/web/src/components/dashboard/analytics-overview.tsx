"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { DeliveryTrendChart } from "../analytics/delivery-trend-chart";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import type { DeliveryMetricsResponse } from "../../lib/api-client";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function AnalyticsOverview({
  accountId,
  locale,
}: {
  accountId: string;
  locale: string;
}) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tAnalytics = useTranslations("analytics");
  const [metrics, setMetrics] = useState<DeliveryMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const lastRequestKeyRef = useRef("");

  const apiUrl = useMemo(
    () => (typeof window !== "undefined" ? getApiUrl() : ""),
    [],
  );

  useEffect(() => {
    const hasToken =
      typeof sessionStorage !== "undefined"
        ? Boolean(sessionStorage.getItem("accessToken"))
        : false;

    if (!accountId || !apiUrl || !hasToken) {
      setLoading(false);
      return;
    }

    const requestKey = `${apiUrl}:${accountId}:7d`;
    if (lastRequestKeyRef.current === requestKey) {
      return;
    }
    lastRequestKeyRef.current = requestKey;

    let cancelled = false;
    const client = createApiClient(apiUrl);
    setLoading(true);
    setError(false);

    client.analytics.delivery(accountId, { period: "7d" })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setMetrics(result.value);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, apiUrl]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-steel-500">
          {t("analyticsSnapshot")}
        </h2>
        <Link
          href={`/${locale}/analytics`}
          className="inline-flex items-center gap-1 text-xs font-medium text-steel-500 hover:text-steel-600"
        >
          {t("openAnalytics")}
          <ArrowRight size={12} />
        </Link>
      </div>

      <Card className="border-gray-200">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base text-cobalt-700">
                {t("analyticsSnapshotTitle")}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("analyticsSnapshotDescription")}
              </p>
            </div>
            <div className="hidden rounded-full bg-steel-50 px-3 py-1 text-xs font-medium text-steel-600 sm:block">
              {t("last7Days")}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <p className="py-6 text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : error || !metrics ? (
            <p className="py-6 text-sm text-muted-foreground">{t("analyticsUnavailable")}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs text-muted-foreground">{t("totalSent")}</p>
                  <p className="mt-1 text-2xl font-semibold text-cobalt-700">
                    {metrics.total_sent.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs text-muted-foreground">{t("readRate")}</p>
                  <p className="mt-1 text-2xl font-semibold text-cobalt-700">
                    {formatPercent(metrics.read_rate)}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs text-muted-foreground">{t("clickCount")}</p>
                  <p className="mt-1 text-2xl font-semibold text-cobalt-700">
                    {metrics.click_count.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs text-muted-foreground">{t("cvEventCount")}</p>
                  <p className="mt-1 text-2xl font-semibold text-cobalt-700">
                    {metrics.cv_event_count.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-steel-50/40 p-4">
                <p className="mb-1 text-sm font-medium text-cobalt-700">
                  {tAnalytics("deliveryTrend")}
                </p>
                <p className="mb-4 text-xs text-muted-foreground">
                  {tAnalytics("deliveryTrendDescription")}
                </p>
                <DeliveryTrendChart
                  locale={locale}
                  stats={metrics.daily_stats}
                  compact
                  height={250}
                  labels={{
                    visibleMetrics: tAnalytics("visibleMetrics"),
                    rangeSummary: tAnalytics("rangeSummary"),
                    latestDay: tAnalytics("latestDay"),
                    noData: t("analyticsUnavailable"),
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
                      label: tAnalytics("totalDelivered"),
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
                      label: tAnalytics("totalFailed"),
                    },
                  ]}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
