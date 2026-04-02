-- トリガー定義テーブル
CREATE TABLE triggers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'partial',
  keywords TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  schedule_config TEXT,
  fire_mode TEXT NOT NULL DEFAULT 'unlimited',
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_triggers_account ON triggers(account_id, is_active);

-- トリガー発火履歴（稼働回数制御用）
CREATE TABLE trigger_fire_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  trigger_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  fired_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (trigger_id) REFERENCES triggers(id) ON DELETE CASCADE,
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_fire_logs_trigger_user ON trigger_fire_logs(trigger_id, ig_user_id);
