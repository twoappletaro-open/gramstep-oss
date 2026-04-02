import type { Result } from "@gramstep/shared";
import type { AppError, HealthScore } from "@gramstep/shared";
import type { HealthLog } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

// Thresholds for health score calculation
const ERROR_RATE_WARNING = 0.10; // 10%
const ERROR_RATE_DANGER = 0.25; // 25%
const RATE_LIMIT_HITS_WARNING = 3;
const RATE_LIMIT_HITS_DANGER = 10;
const POLICY_VIOLATION_DANGER = 1;
const LOOKBACK_SECONDS = 300; // 5 minutes

export interface HealthCheckResult {
  checked: number;
  alerts: Array<{ accountId: string; score: HealthScore; reason: string }>;
}

export interface HealthMonitorService {
  calculateHealthScore(accountId: string): Promise<Result<HealthScore, AppError>>;
  getHealthHistory(accountId: string, days: number): Promise<Result<HealthLog[], AppError>>;
  executeHealthCheck(): Promise<Result<HealthCheckResult, AppError>>;
}

export interface HealthMonitorDeps {
  db: D1Database;
  kv: KVNamespace;
  now: () => number;
}

export function createHealthMonitor(deps: HealthMonitorDeps): HealthMonitorService {
  const { db, now } = deps;

  async function getMetrics(
    accountId: string,
    since: number,
  ): Promise<{
    errorRate: number;
    rateLimitHits: number;
    policyViolations: number;
    totalMessages: number;
    errorMessages: number;
  }> {
    // Count total outbound messages in lookback window
    const totalResult = await db
      .prepare(
        `SELECT COUNT(*) as count FROM message_logs
         WHERE account_id = ? AND direction = 'outbound' AND created_at >= ?`,
      )
      .bind(accountId, since)
      .first<{ count: number }>();
    const totalMessages = totalResult?.count ?? 0;

    // Count failed messages
    const errorResult = await db
      .prepare(
        `SELECT COUNT(*) as count FROM message_logs
         WHERE account_id = ? AND direction = 'outbound' AND delivery_status = 'failed' AND created_at >= ?`,
      )
      .bind(accountId, since)
      .first<{ count: number }>();
    const errorMessages = errorResult?.count ?? 0;

    // Count rate limit events
    const rateLimitResult = await db
      .prepare(
        `SELECT COUNT(*) as count FROM webhook_events
         WHERE account_id = ? AND event_type = 'rate_limit' AND processed_at >= ?`,
      )
      .bind(accountId, since)
      .first<{ count: number }>();
    const rateLimitHits = rateLimitResult?.count ?? 0;

    // Count policy violation events
    const policyResult = await db
      .prepare(
        `SELECT COUNT(*) as count FROM webhook_events
         WHERE account_id = ? AND event_type = 'policy_violation' AND processed_at >= ?`,
      )
      .bind(accountId, since)
      .first<{ count: number }>();
    const policyViolations = policyResult?.count ?? 0;

    const errorRate = totalMessages > 0 ? errorMessages / totalMessages : 0;

    return { errorRate, rateLimitHits, policyViolations, totalMessages, errorMessages };
  }

  function determineScore(metrics: {
    errorRate: number;
    rateLimitHits: number;
    policyViolations: number;
  }): { score: HealthScore; reason: string } {
    // Policy violations → immediate danger
    if (metrics.policyViolations >= POLICY_VIOLATION_DANGER) {
      return { score: "danger", reason: `ポリシー違反検知: ${metrics.policyViolations}件` };
    }

    // High error rate → danger
    if (metrics.errorRate >= ERROR_RATE_DANGER) {
      return { score: "danger", reason: `APIエラー率: ${(metrics.errorRate * 100).toFixed(1)}%` };
    }

    // Many rate limit hits → danger
    if (metrics.rateLimitHits >= RATE_LIMIT_HITS_DANGER) {
      return { score: "danger", reason: `レート制限到達: ${metrics.rateLimitHits}回` };
    }

    // Moderate error rate → warning
    if (metrics.errorRate >= ERROR_RATE_WARNING) {
      return { score: "warning", reason: `APIエラー率: ${(metrics.errorRate * 100).toFixed(1)}%` };
    }

    // Some rate limit hits → warning
    if (metrics.rateLimitHits >= RATE_LIMIT_HITS_WARNING) {
      return { score: "warning", reason: `レート制限到達: ${metrics.rateLimitHits}回` };
    }

    return { score: "normal", reason: "" };
  }

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    calculateHealthScore: (accountId) =>
      wrapD1(async () => {
        const since = now() - LOOKBACK_SECONDS;
        const metrics = await getMetrics(accountId, since);
        const { score } = determineScore(metrics);

        const logId = generateId();
        await db
          .prepare(
            `INSERT INTO health_logs (id, account_id, score, api_error_rate, rate_limit_hit_count, policy_violation_count, calculated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(logId, accountId, score, metrics.errorRate, metrics.rateLimitHits, metrics.policyViolations, now())
          .run();

        await db
          .prepare(`UPDATE accounts SET health_score = ? WHERE id = ?`)
          .bind(score, accountId)
          .run();

        return ok(score);
      }),

    getHealthHistory: (accountId, days) =>
      wrapD1(async () => {
        const since = now() - days * 86400;
        const result = await db
          .prepare(
            `SELECT * FROM health_logs WHERE account_id = ? AND calculated_at >= ? ORDER BY calculated_at DESC`,
          )
          .bind(accountId, since)
          .all<HealthLog>();
        return ok(result.results);
      }),

    executeHealthCheck: () =>
      wrapD1(async () => {
        const accountsResult = await db
          .prepare(`SELECT id, health_score FROM accounts`)
          .bind()
          .all<{ id: string; health_score: string }>();

        const accounts = accountsResult.results;
        const alerts: HealthCheckResult["alerts"] = [];

        for (const account of accounts) {
          const since = now() - LOOKBACK_SECONDS;
          const metrics = await getMetrics(account.id, since);
          const { score, reason } = determineScore(metrics);

          // Only write when score changes or on warning/danger (reduces D1 writes)
          const scoreChanged = score !== account.health_score;
          if (scoreChanged || score === "warning" || score === "danger") {
            const logId = generateId();
            await db
              .prepare(
                `INSERT INTO health_logs (id, account_id, score, api_error_rate, rate_limit_hit_count, policy_violation_count, calculated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(logId, account.id, score, metrics.errorRate, metrics.rateLimitHits, metrics.policyViolations, now())
              .run();
          }

          if (scoreChanged) {
            await db
              .prepare(`UPDATE accounts SET health_score = ? WHERE id = ?`)
              .bind(score, account.id)
              .run();
          }

          if (score === "warning" || score === "danger") {
            alerts.push({ accountId: account.id, score: score as HealthScore, reason });
          }
        }

        return ok({ checked: accounts.length, alerts });
      }),
  };
}
