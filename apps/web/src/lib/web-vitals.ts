/**
 * Web Vitals計測・SLO評価モジュール
 *
 * - 管理画面ページロード p95 < 3秒（Req 21.2）
 * - 可用性 99.9%（Cloudflare Workers SLA）（Req 21.3）
 */

// ────────── Constants ──────────

export const WEB_VITALS_THRESHOLDS = {
  /** ページロード p95 閾値（ms） */
  PAGE_LOAD_P95_MS: 3000,
  /** Largest Contentful Paint 閾値（ms） */
  LCP_MS: 2500,
  /** First Input Delay 閾値（ms） */
  FID_MS: 100,
  /** Cumulative Layout Shift 閾値 */
  CLS: 0.1,
  /** Interaction to Next Paint 閾値（ms） */
  INP_MS: 200,
  /** Time to First Byte 閾値（ms） */
  TTFB_MS: 800,
} as const;

export const AVAILABILITY_TARGET = {
  /** 可用性目標（%） */
  PERCENT: 99.9,
  /** 月間許容ダウンタイム（分）: 30日 × 24h × 60min × 0.001 */
  MONTHLY_DOWNTIME_MINUTES: 30 * 24 * 60 * 0.001,
} as const;

// ────────── Types ──────────

export type WebVitalName = "LCP" | "FID" | "CLS" | "INP" | "TTFB";

export interface WebVitalsMetric {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
}

export interface WebVitalsReport {
  pass: boolean;
  metrics: WebVitalsMetric[];
  violations: string[];
  evaluatedAt: number;
}

export interface AvailabilityConfig {
  totalRequests: number;
  successfulRequests: number;
  periodDays: number;
}

export interface AvailabilityReport {
  availabilityPercent: number;
  meetsSlo: boolean;
  errorCount: number;
  totalRequests: number;
  periodDays: number;
  dataSource: "cloudflare-analytics";
  targetPercent: number;
}

// ────────── Thresholds Map ──────────

const THRESHOLD_MAP: Record<string, number> = {
  LCP: WEB_VITALS_THRESHOLDS.LCP_MS,
  FID: WEB_VITALS_THRESHOLDS.FID_MS,
  CLS: WEB_VITALS_THRESHOLDS.CLS,
  INP: WEB_VITALS_THRESHOLDS.INP_MS,
  TTFB: WEB_VITALS_THRESHOLDS.TTFB_MS,
};

// ────────── Functions ──────────

export function evaluateWebVitals(metrics: WebVitalsMetric[]): WebVitalsReport {
  const violations: string[] = [];

  for (const metric of metrics) {
    const threshold = THRESHOLD_MAP[metric.name];
    if (threshold !== undefined && metric.value > threshold) {
      violations.push(metric.name);
    }
  }

  return {
    pass: violations.length === 0,
    metrics,
    violations,
    evaluatedAt: Math.floor(Date.now() / 1000),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export function isPageLoadWithinSlo(loadTimesMs: number[]): boolean {
  if (loadTimesMs.length === 0) return true;
  const sorted = [...loadTimesMs].sort((a, b) => a - b);
  return percentile(sorted, 95) <= WEB_VITALS_THRESHOLDS.PAGE_LOAD_P95_MS;
}

export function createAvailabilityReport(config: AvailabilityConfig): AvailabilityReport {
  const { totalRequests, successfulRequests, periodDays } = config;

  const availabilityPercent =
    totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

  return {
    availabilityPercent,
    meetsSlo: availabilityPercent >= AVAILABILITY_TARGET.PERCENT,
    errorCount: totalRequests - successfulRequests,
    totalRequests,
    periodDays,
    dataSource: "cloudflare-analytics",
    targetPercent: AVAILABILITY_TARGET.PERCENT,
  };
}

// ────────── Browser Reporter ──────────

/**
 * ブラウザ環境でWeb Vitalsを収集し、analyticsエンドポイントに送信する。
 * Next.js App RouterのreportWebVitalsから呼び出す。
 *
 * 使い方（layout.tsx）:
 *   import { reportWebVital } from '@/lib/web-vitals';
 *   export function reportWebVitals(metric: { name: string; value: number }) {
 *     reportWebVital(metric);
 *   }
 */
export function reportWebVital(metric: {
  name: string;
  value: number;
  rating?: string;
}): void {
  // Cloudflare Analytics連携: navigator.sendBeacon で非同期送信
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating ?? "unknown",
      pathname: typeof window !== "undefined" ? window.location.pathname : "",
      timestamp: Date.now(),
    });
    navigator.sendBeacon("/api/vitals", body);
  }
}
