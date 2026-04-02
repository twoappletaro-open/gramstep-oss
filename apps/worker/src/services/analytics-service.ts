import type { Result, AppError, DeliveryMetrics, AccountHealth, HealthScore } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import { executeQuery, executeFirst } from "@gramstep/db";

const PERIOD_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const DEFAULT_DAILY_LIMIT = 2500;

interface DailyRow {
  date: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

interface WindowStats {
  total: number;
  active: number;
}

interface EnrollmentStats {
  total: number;
  completed: number;
  window_expired: number;
}

interface ClickCvStats {
  click_count: number;
  cv_event_count: number;
}

interface AccountRow {
  id: string;
  ig_username: string | null;
  access_token_encrypted: string;
  token_expires_at: number;
  health_score: string;
}

interface DailySentRow {
  daily_sent: number;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export async function getDeliveryMetrics(
  db: D1Database,
  accountId: string,
  period: string,
  now: number,
): Promise<Result<DeliveryMetrics, AppError>> {
  const days = PERIOD_DAYS[period] ?? 30;
  const periodStart = now - days * 86400;

  const dailyResult = await executeQuery<DailyRow>(
    db,
    `SELECT DATE(created_at, 'unixepoch') AS date,
            SUM(CASE WHEN delivery_status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN delivery_status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN delivery_status = 'read' THEN 1 ELSE 0 END) AS read,
            SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM message_logs
     WHERE account_id = ? AND created_at >= ? AND direction = 'outbound' AND is_test = 0
     GROUP BY DATE(created_at, 'unixepoch')
     ORDER BY date`,
    accountId,
    periodStart,
  );
  if (!dailyResult.ok) {
    return err(createAppError("D1_ERROR", dailyResult.error.message));
  }

  const dailyStats = dailyResult.value.results;

  const totalSent = dailyStats.reduce((s, r) => s + r.sent, 0);
  const totalDelivered = dailyStats.reduce((s, r) => s + r.delivered, 0);
  const totalRead = dailyStats.reduce((s, r) => s + r.read, 0);
  const totalFailed = dailyStats.reduce((s, r) => s + r.failed, 0);

  // Window validity: active windows / total windows in period
  const windowResult = await executeFirst<WindowStats>(
    db,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN window_expires_at > ? THEN 1 ELSE 0 END) AS active
     FROM messaging_windows
     WHERE account_id = ? AND window_opened_at >= ?
     /* window_validity */`,
    now,
    accountId,
    periodStart,
  );

  const windowStats: WindowStats = windowResult.ok && windowResult.value
    ? windowResult.value
    : { total: 0, active: 0 };

  // Scenario enrollment stats
  const enrollmentResult = await executeFirst<EnrollmentStats>(
    db,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status = 'window_expired' THEN 1 ELSE 0 END) AS window_expired
     FROM scenario_enrollments
     WHERE account_id = ? AND started_at >= ?`,
    accountId,
    periodStart,
  );

  const enrollStats: EnrollmentStats = enrollmentResult.ok && enrollmentResult.value
    ? enrollmentResult.value
    : { total: 0, completed: 0, window_expired: 0 };

  // Click and CV counts (from link_clicks and cv_events if available)
  const clickCvResult = await executeFirst<ClickCvStats>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM link_clicks WHERE account_id = ? AND clicked_at >= ?) AS click_count,
       (SELECT COUNT(*) FROM conversion_events WHERE account_id = ? AND created_at >= ?) AS cv_event_count`,
    accountId,
    periodStart,
    accountId,
    periodStart,
  );

  const clickCv: ClickCvStats = clickCvResult.ok && clickCvResult.value
    ? clickCvResult.value
    : { click_count: 0, cv_event_count: 0 };

  return ok({
    daily_stats: dailyStats,
    total_sent: totalSent,
    total_delivered: totalDelivered,
    total_read: totalRead,
    total_failed: totalFailed,
    read_rate: safeRate(totalRead, totalSent),
    click_count: clickCv.click_count,
    click_rate: safeRate(clickCv.click_count, totalSent),
    cv_event_count: clickCv.cv_event_count,
    window_validity_rate: safeRate(windowStats.active, windowStats.total),
    window_expiry_dropout_rate: safeRate(enrollStats.window_expired, enrollStats.total),
    scenario_completion_rate: safeRate(enrollStats.completed, enrollStats.total),
  });
}

export async function getAccountHealth(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<Result<AccountHealth, AppError>> {
  const accountResult = await executeFirst<AccountRow>(
    db,
    "SELECT id, ig_username, access_token_encrypted, token_expires_at, health_score FROM accounts WHERE id = ?",
    accountId,
  );
  if (!accountResult.ok) {
    return err(createAppError("D1_ERROR", accountResult.error.message));
  }
  if (!accountResult.value) {
    return err(createAppError("NOT_FOUND", "Account not found"));
  }

  const account = accountResult.value;
  const tokenExpired = account.token_expires_at <= now;
  const daysRemaining = tokenExpired
    ? 0
    : Math.floor((account.token_expires_at - now) / 86400);

  // Daily sent count (today)
  const todayStart = now - (now % 86400);
  const sentResult = await executeFirst<DailySentRow>(
    db,
    `SELECT COUNT(*) AS daily_sent FROM message_logs
     WHERE account_id = ? AND direction = 'outbound' AND is_test = 0 AND created_at >= ?`,
    accountId,
    todayStart,
  );

  const dailySent = sentResult.ok && sentResult.value ? sentResult.value.daily_sent : 0;

  return ok({
    account_id: account.id,
    ig_username: account.ig_username,
    connected: !tokenExpired,
    token_expires_at: account.token_expires_at,
    token_days_remaining: daysRemaining,
    health_score: account.health_score as HealthScore,
    rate_limit_usage: {
      daily_sent: dailySent,
      daily_limit: DEFAULT_DAILY_LIMIT,
      usage_percent: (dailySent / DEFAULT_DAILY_LIMIT) * 100,
    },
  });
}
