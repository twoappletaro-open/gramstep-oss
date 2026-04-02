"use client";

import { useMemo, useState } from "react";
import type { DailyDeliveryStatResponse } from "../../lib/api-client";

type SeriesKey = "sent" | "delivered" | "read" | "failed";

type SeriesConfig = {
  key: SeriesKey;
  color: string;
  fillClassName: string;
  textClassName: string;
  label: string;
};

type ChartLabels = {
  visibleMetrics: string;
  rangeSummary: string;
  latestDay: string;
  noData: string;
};

const DEFAULT_VISIBLE_KEYS: SeriesKey[] = ["sent", "delivered", "read"];

function buildChartPath(
  values: number[],
  width: number,
  height: number,
  paddingX: number,
  paddingTop: number,
  paddingBottom: number,
): string {
  if (values.length === 0) return "";

  const drawableWidth = width - paddingX * 2;
  const drawableHeight = height - paddingTop - paddingBottom;
  const maxValue = Math.max(...values, 1);

  return values
    .map((value, index) => {
      const x = values.length === 1
        ? width / 2
        : paddingX + (drawableWidth * index) / (values.length - 1);
      const y = paddingTop + drawableHeight - (value / maxValue) * drawableHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function buildPoint(
  value: number,
  index: number,
  total: number,
  width: number,
  height: number,
  paddingX: number,
  paddingTop: number,
  paddingBottom: number,
  maxValue: number,
) {
  const drawableWidth = width - paddingX * 2;
  const drawableHeight = height - paddingTop - paddingBottom;
  const x = total === 1
    ? width / 2
    : paddingX + (drawableWidth * index) / (total - 1);
  const y = paddingTop + drawableHeight - (value / Math.max(maxValue, 1)) * drawableHeight;

  return { x, y };
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatShortDate(date: string, locale: string): string {
  const normalizedLocale = locale === "ja" ? "ja-JP" : "en-US";
  return new Intl.DateTimeFormat(normalizedLocale, {
    month: "numeric",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export function DeliveryTrendChart({
  locale,
  stats,
  labels,
  series,
  initialVisibleKeys = DEFAULT_VISIBLE_KEYS,
  height = 280,
  compact = false,
}: {
  locale: string;
  stats: DailyDeliveryStatResponse[];
  labels: ChartLabels;
  series: SeriesConfig[];
  initialVisibleKeys?: SeriesKey[];
  height?: number;
  compact?: boolean;
}) {
  const [visibleKeys, setVisibleKeys] = useState<SeriesKey[]>(initialVisibleKeys);

  const width = 760;
  const paddingX = compact ? 24 : 40;
  const paddingTop = 16;
  const paddingBottom = compact ? 30 : 38;

  const maxValue = useMemo(() => {
    const visibleSeries = series.filter((item) => visibleKeys.includes(item.key));
    const values = stats.flatMap((row) => visibleSeries.map((item) => row[item.key]));
    return Math.max(...values, 1);
  }, [series, stats, visibleKeys]);

  const yAxisTicks = useMemo(() => {
    const mid = Math.ceil(maxValue / 2);
    return [...new Set([maxValue, mid, 0])];
  }, [maxValue]);

  const xAxisIndexes = useMemo(() => {
    if (stats.length <= 4) return stats.map((_, index) => index);
    if (stats.length <= 7) return stats.map((_, index) => index);

    const indexes = [0, Math.floor((stats.length - 1) / 2), stats.length - 1];
    return [...new Set(indexes)];
  }, [stats]);

  const latestDate = stats[stats.length - 1]?.date ?? "";

  function toggleSeries(key: SeriesKey) {
    setVisibleKeys((current) => {
      if (current.includes(key)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  }

  if (stats.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white/70 px-4 py-8 text-sm text-muted-foreground">
        {labels.noData}
      </div>
    );
  }

  const firstDate = stats.at(0)?.date ?? latestDate;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-steel-500">
          {labels.visibleMetrics}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {series.map((item) => {
            const isActive = visibleKeys.includes(item.key);
            const total = stats.reduce((sum, row) => sum + row[item.key], 0);
            const latest = stats[stats.length - 1]?.[item.key] ?? 0;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleSeries(item.key)}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  isActive
                    ? "border-steel-300 bg-white shadow-sm"
                    : "border-gray-200 bg-gray-50/70"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.fillClassName}`} />
                  <span className="text-sm font-medium text-cobalt-700">{item.label}</span>
                </div>
                <p className={`mt-2 text-xl font-semibold ${item.textClassName}`}>
                  {formatNumber(total)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {labels.latestDay}: {formatShortDate(latestDate, locale)} / {formatNumber(latest)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-steel-50/30 p-3 sm:p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
          {yAxisTicks.map((tick) => {
            const { y } = buildPoint(
              tick,
              0,
              1,
              width,
              height,
              paddingX,
              paddingTop,
              paddingBottom,
              maxValue,
            );

            return (
              <g key={tick}>
                <line
                  x1={paddingX}
                  x2={width - paddingX}
                  y1={y}
                  y2={y}
                  stroke="#D9E2EC"
                  strokeDasharray="4 6"
                />
                <text
                  x={paddingX - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-steel-500 text-[11px]"
                >
                  {formatNumber(tick)}
                </text>
              </g>
            );
          })}

          {series
            .filter((item) => visibleKeys.includes(item.key))
            .map((item) => {
              const values = stats.map((row) => row[item.key]);
              const path = buildChartPath(
                values,
                width,
                height,
                paddingX,
                paddingTop,
                paddingBottom,
              );

              return (
                <g key={item.key}>
                  <path
                    d={path}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {values.map((value, index) => {
                    const point = buildPoint(
                      value,
                      index,
                      values.length,
                      width,
                      height,
                      paddingX,
                      paddingTop,
                      paddingBottom,
                      maxValue,
                    );

                    return (
                      <circle
                        key={`${item.key}-${stats[index]?.date ?? index}`}
                        cx={point.x}
                        cy={point.y}
                        r="3.5"
                        fill={item.color}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                    );
                  })}
                </g>
              );
            })}

          {xAxisIndexes.map((index) => {
            const point = buildPoint(
              0,
              index,
              stats.length,
              width,
              height,
              paddingX,
              paddingTop,
              paddingBottom,
              1,
            );

            return (
              <text
                key={stats[index]?.date ?? index}
                x={point.x}
                y={height - 8}
                textAnchor="middle"
                className="fill-steel-500 text-[11px]"
              >
                {stats[index] ? formatShortDate(stats[index].date, locale) : ""}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {labels.rangeSummary}: {formatShortDate(firstDate, locale)} - {formatShortDate(latestDate, locale)}
        </p>
        <p>
          {labels.latestDay}: {formatShortDate(latestDate, locale)}
        </p>
      </div>
    </div>
  );
}
