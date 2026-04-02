-- Migration: 0001_initial_schema
-- Phase 1 MVP tables for GramStep

-- アカウント管理
CREATE TABLE accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ig_user_id TEXT NOT NULL UNIQUE,
  ig_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  settings TEXT DEFAULT '{"delivery_window_start":9,"delivery_window_end":23,"re_engagement_enabled":true,"opt_out_keywords":["停止","解除","stop"]}',
  health_score TEXT NOT NULL DEFAULT 'normal',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ユーザー（IGフォロワー/DM相手）
CREATE TABLE ig_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  ig_scoped_id TEXT NOT NULL,
  ig_username TEXT,
  display_name TEXT,
  follower_status TEXT DEFAULT 'unknown',
  is_opted_out INTEGER NOT NULL DEFAULT 0,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  profile_image_r2_key TEXT,
  timezone TEXT,
  preferred_delivery_hour INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_interaction_at INTEGER,
  block_error_count INTEGER NOT NULL DEFAULT 0,
  block_retry_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_ig_users_account_igsid ON ig_users(account_id, ig_scoped_id);
CREATE INDEX idx_ig_users_interaction ON ig_users(account_id, last_interaction_at);

-- メッセージングウィンドウ
CREATE TABLE messaging_windows (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  window_opened_at INTEGER NOT NULL,
  window_expires_at INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  re_engagement_sent INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_windows_account_user ON messaging_windows(account_id, ig_user_id);
CREATE INDEX idx_windows_expires ON messaging_windows(window_expires_at) WHERE is_active = 1;

-- タグ
CREATE TABLE tags (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_tags_account_name ON tags(account_id, name);

CREATE TABLE ig_user_tags (
  ig_user_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (ig_user_id, tag_id),
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- シナリオ（ステップ配信）
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  bot_disclosure_enabled INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE scenario_steps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  scenario_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  absolute_datetime INTEGER,
  message_type TEXT NOT NULL,
  message_payload TEXT NOT NULL,
  condition_config TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);
CREATE INDEX idx_steps_scenario ON scenario_steps(scenario_id, step_order);

CREATE TABLE scenario_enrollments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  scenario_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  current_step_order INTEGER NOT NULL DEFAULT 0,
  workflow_instance_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_enrollments_status ON scenario_enrollments(status);
CREATE INDEX idx_enrollments_user ON scenario_enrollments(ig_user_id, status);

-- Webhook冪等性
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- メッセージログ
CREATE TABLE message_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'sent',
  ig_message_id TEXT,
  media_r2_key TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_user ON message_logs(account_id, ig_user_id, created_at);
CREATE INDEX idx_messages_status ON message_logs(delivery_status) WHERE delivery_status != 'read';
CREATE INDEX idx_messages_ig_id ON message_logs(ig_message_id) WHERE ig_message_id IS NOT NULL;

-- 管理者・オペレーター
CREATE TABLE operators (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 監査ログ（追記専用）
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  operator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (operator_id) REFERENCES operators(id)
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- Workflowチェックポイント（3日超sleep用）
CREATE TABLE workflow_checkpoints (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  enrollment_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  next_step_order INTEGER NOT NULL,
  resume_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (enrollment_id) REFERENCES scenario_enrollments(id) ON DELETE CASCADE
);
CREATE INDEX idx_checkpoints_resume ON workflow_checkpoints(resume_at) WHERE status = 'pending';

-- スコアリングルール
CREATE TABLE scoring_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  score_delta INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- attachment_idキャッシュ
CREATE TABLE attachment_cache (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  media_url_hash TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_attachment_account_hash ON attachment_cache(account_id, media_url_hash);

-- テストアカウント
CREATE TABLE test_accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  ig_scoped_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- データ削除管理
CREATE TABLE deleted_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  ig_scoped_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
  physical_deleted_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_deleted_pending ON deleted_users(requested_at) WHERE status = 'pending';

-- オペレーター・アカウントアクセス制御
CREATE TABLE operator_account_access (
  operator_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (operator_id, account_id),
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
