import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import { executeFirst, executeRun, generateId } from "@gramstep/db";

// ────────── Constants ──────────

export const SLO_THRESHOLDS = {
  /** Webhook p99応答時間の上限（ミリ秒） */
  WEBHOOK_P99_MS: 5000,
  /** アラート発報に必要な連続violation回数（5分Cron間隔 × 1回 = 5分連続） */
  CONSECUTIVE_ALERT_THRESHOLD: 1,
  /** エスカレーション（Issue作成）に必要な連続violation回数（5分 × 6 = 30分） */
  CONSECUTIVE_ESCALATION_THRESHOLD: 6,
  /** p99計算対象の直近秒数（5分） */
  P99_WINDOW_SECONDS: 300,
} as const;

const KV_KEY_CONSECUTIVE = "slo:webhook_p99:consecutive_violations";
const KV_TTL_SECONDS = 3600; // 1時間でauto-expire

// ────────── Types ──────────

export interface SloMonitorDeps {
  db: D1Database;
  kv: KVNamespace;
  notifyWebhookUrl: string;
  fetch: typeof fetch;
  now: () => number;
}

export interface P99CheckResult {
  violated: boolean;
  currentValueMs: number;
  thresholdMs: number;
}

export interface SloViolation {
  metric: string;
  currentValueMs: number;
  thresholdMs: number;
  consecutiveCount: number;
  detectedAt: number;
}

export interface SloCheckResult {
  violated: boolean;
  alertSent: boolean;
  escalated: boolean;
  recorded: boolean;
  p99Ms: number;
  consecutiveCount: number;
}

export interface SloMonitorService {
  checkWebhookP99(): Promise<Result<P99CheckResult, AppError>>;
  trackConsecutiveViolations(violated: boolean): Promise<number>;
  shouldAlert(consecutiveCount: number): boolean;
  sendCriticalAlert(violation: SloViolation): Promise<Result<void, AppError>>;
  recordViolation(violation: SloViolation): Promise<Result<void, AppError>>;
  createEscalationIssue(violation: SloViolation): Promise<Result<void, AppError>>;
  execute(): Promise<Result<SloCheckResult, AppError>>;
}

// ────────── Factory ──────────

export function createSloMonitorService(deps: SloMonitorDeps): SloMonitorService {
  const { db, kv, notifyWebhookUrl, now } = deps;
  const fetchFn = deps.fetch;

  return {
    async checkWebhookP99(): Promise<Result<P99CheckResult, AppError>> {
      const windowStart = now() - SLO_THRESHOLDS.P99_WINDOW_SECONDS;

      const result = await executeFirst<{ p99_response_ms: number }>(
        db,
        `SELECT MAX(response_time_ms) AS p99_response_ms
         FROM (
           SELECT response_time_ms
           FROM webhook_events
           WHERE processed_at >= ?
             AND response_time_ms IS NOT NULL
           ORDER BY response_time_ms ASC
           LIMIT (
             SELECT CAST(COUNT(*) * 0.99 AS INTEGER)
             FROM webhook_events
             WHERE processed_at >= ?
               AND response_time_ms IS NOT NULL
           )
         )`,
        windowStart,
        windowStart,
      );

      if (!result.ok) {
        return err(createAppError("D1_ERROR", result.error.message));
      }

      const p99Ms = result.value?.p99_response_ms ?? 0;

      return ok({
        violated: p99Ms > SLO_THRESHOLDS.WEBHOOK_P99_MS,
        currentValueMs: p99Ms,
        thresholdMs: SLO_THRESHOLDS.WEBHOOK_P99_MS,
      });
    },

    async trackConsecutiveViolations(violated: boolean): Promise<number> {
      if (!violated) {
        await kv.delete(KV_KEY_CONSECUTIVE);
        return 0;
      }

      const current = await kv.get(KV_KEY_CONSECUTIVE);
      const count = (current ? parseInt(current, 10) : 0) + 1;
      await kv.put(KV_KEY_CONSECUTIVE, String(count), {
        expirationTtl: KV_TTL_SECONDS,
      });
      return count;
    },

    shouldAlert(consecutiveCount: number): boolean {
      return consecutiveCount >= SLO_THRESHOLDS.CONSECUTIVE_ALERT_THRESHOLD;
    },

    async sendCriticalAlert(violation: SloViolation): Promise<Result<void, AppError>> {
      if (!notifyWebhookUrl) {
        return err(createAppError("VALIDATION_ERROR", "Notification webhook URL is not configured"));
      }

      const payload = {
        severity: "critical",
        metric: violation.metric,
        current_value_ms: violation.currentValueMs,
        threshold_ms: violation.thresholdMs,
        consecutive_count: violation.consecutiveCount,
        detected_at: violation.detectedAt,
        message: `SLO violation: ${violation.metric} = ${violation.currentValueMs}ms (threshold: ${violation.thresholdMs}ms), ${violation.consecutiveCount} consecutive checks`,
        runbook: [
          "1. 原因特定: D1日次制限? Queues枯渇? Instagram API障害?",
          "2. 緩和策: グレースフルデグラデーション / 送信速度低減 / Cron一時停止",
          "3. audit_logsに対応内容を記録",
          "4. 30分以内に緩和不可 → GitHub Issue作成",
        ],
      };

      const response = await fetchFn(notifyWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return err(
          createAppError("EXTERNAL_API_ERROR", `Alert webhook failed: ${response.status}`),
        );
      }

      return ok(undefined);
    },

    async recordViolation(violation: SloViolation): Promise<Result<void, AppError>> {
      const id = generateId();
      const details = JSON.stringify({
        metric: violation.metric,
        current_value_ms: violation.currentValueMs,
        threshold_ms: violation.thresholdMs,
        consecutive_count: violation.consecutiveCount,
      });

      const result = await executeRun(
        db,
        `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        "system",
        "slo_violation_response",
        "system",
        violation.metric,
        details,
        violation.detectedAt,
      );

      if (!result.ok) {
        return err(createAppError("D1_ERROR", result.error.message));
      }

      return ok(undefined);
    },

    async createEscalationIssue(violation: SloViolation): Promise<Result<void, AppError>> {
      if (!notifyWebhookUrl) {
        return err(createAppError("VALIDATION_ERROR", "Notification webhook URL is not configured"));
      }

      const payload = {
        severity: "critical",
        action: "create_issue",
        title: `[SLO Violation] ${violation.metric}: ${violation.currentValueMs}ms > ${violation.thresholdMs}ms (${violation.consecutiveCount * 5}分連続)`,
        body: [
          `## SLO Violation Report`,
          `- **Metric**: ${violation.metric}`,
          `- **Current**: ${violation.currentValueMs}ms`,
          `- **Threshold**: ${violation.thresholdMs}ms`,
          `- **Duration**: ${violation.consecutiveCount * 5}分連続 (${violation.consecutiveCount} checks)`,
          `- **Detected**: ${new Date(violation.detectedAt * 1000).toISOString()}`,
          ``,
          `## Runbook`,
          `1. 原因特定: D1日次制限? Queues枯渇? Instagram API障害?`,
          `2. 緩和策: グレースフルデグラデーション / 送信速度低減 / Cron一時停止`,
          `3. audit_logsに対応内容を記録`,
        ].join("\n"),
        labels: ["slo-violation", "critical"],
      };

      const response = await fetchFn(notifyWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return err(
          createAppError("EXTERNAL_API_ERROR", `Escalation webhook failed: ${response.status}`),
        );
      }

      return ok(undefined);
    },

    async execute(): Promise<Result<SloCheckResult, AppError>> {
      // 1. p99応答時間チェック
      const p99Result = await this.checkWebhookP99();
      if (!p99Result.ok) {
        return err(p99Result.error);
      }

      const { violated, currentValueMs } = p99Result.value;

      // 2. 連続violation回数を更新
      const consecutiveCount = await this.trackConsecutiveViolations(violated);

      const checkResult: SloCheckResult = {
        violated,
        alertSent: false,
        escalated: false,
        recorded: false,
        p99Ms: currentValueMs,
        consecutiveCount,
      };

      if (!violated || !this.shouldAlert(consecutiveCount)) {
        return ok(checkResult);
      }

      // 3. criticalアラート送信
      const violation: SloViolation = {
        metric: "webhook_p99",
        currentValueMs,
        thresholdMs: SLO_THRESHOLDS.WEBHOOK_P99_MS,
        consecutiveCount,
        detectedAt: now(),
      };

      const alertResult = await this.sendCriticalAlert(violation);
      checkResult.alertSent = alertResult.ok;

      // 4. audit_logsに記録
      const recordResult = await this.recordViolation(violation);
      checkResult.recorded = recordResult.ok;

      // 5. 30分以上（6回連続）→ エスカレーション（Issue作成）
      if (consecutiveCount >= SLO_THRESHOLDS.CONSECUTIVE_ESCALATION_THRESHOLD) {
        const escalationResult = await this.createEscalationIssue(violation);
        checkResult.escalated = escalationResult.ok;
      }

      return ok(checkResult);
    },
  };
}
