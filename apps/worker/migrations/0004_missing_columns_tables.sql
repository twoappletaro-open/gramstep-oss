-- 0004_missing_columns_tables.sql
-- Add missing columns and tables referenced in codebase

-- Missing columns on ig_users
ALTER TABLE ig_users ADD COLUMN conversation_status TEXT NOT NULL DEFAULT 'unread';
ALTER TABLE ig_users ADD COLUMN custom_status_label TEXT;
ALTER TABLE ig_users ADD COLUMN assigned_operator_id TEXT;
ALTER TABLE ig_users ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'bot';

-- Missing column on webhook_events
ALTER TABLE webhook_events ADD COLUMN response_time_ms INTEGER;

-- Missing column on message_logs
ALTER TABLE message_logs ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- Missing table: api_keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '["read"]',
  expires_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_api_keys_account ON api_keys(account_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Missing table: automation_rules
CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  condition_group TEXT NOT NULL DEFAULT '{"logic":"and","conditions":[]}',
  actions TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_automation_rules_account ON automation_rules(account_id, is_active);
