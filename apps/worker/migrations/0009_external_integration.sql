-- Outgoing Webhook subscriptions
CREATE TABLE outgoing_webhooks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_outgoing_webhooks_account ON outgoing_webhooks(account_id);

-- Outgoing Webhook delivery log
CREATE TABLE outgoing_webhook_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  webhook_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  attempted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (webhook_id) REFERENCES outgoing_webhooks(id) ON DELETE CASCADE
);
CREATE INDEX idx_outgoing_webhook_logs_webhook ON outgoing_webhook_logs(webhook_id);

-- Incoming Webhook endpoints
CREATE TABLE incoming_webhooks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  secret TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_incoming_webhooks_account ON incoming_webhooks(account_id);

-- Conversion points
CREATE TABLE conversion_points (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  value REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_conversion_points_account ON conversion_points(account_id);

-- Conversion events
CREATE TABLE conversion_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  conversion_point_id TEXT NOT NULL,
  ig_user_id TEXT,
  scenario_id TEXT,
  value REAL NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (conversion_point_id) REFERENCES conversion_points(id) ON DELETE CASCADE
);
CREATE INDEX idx_conversion_events_account ON conversion_events(account_id);
CREATE INDEX idx_conversion_events_point ON conversion_events(conversion_point_id);
CREATE INDEX idx_conversion_events_user ON conversion_events(ig_user_id);
CREATE INDEX idx_conversion_events_scenario ON conversion_events(scenario_id);

-- Add name and description columns to api_keys
ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE api_keys ADD COLUMN description TEXT;
