-- health_logs テーブル: アカウントヘルス監視履歴 (Req 14.1-14.3)
CREATE TABLE health_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  score TEXT NOT NULL CHECK(score IN ('normal', 'warning', 'danger')),
  api_error_rate REAL NOT NULL DEFAULT 0,
  rate_limit_hit_count INTEGER NOT NULL DEFAULT 0,
  policy_violation_count INTEGER NOT NULL DEFAULT 0,
  calculated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_health_logs_account ON health_logs(account_id, calculated_at DESC);
