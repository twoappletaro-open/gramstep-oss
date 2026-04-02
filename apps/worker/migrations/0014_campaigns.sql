-- キャンペーン機能（時間指定配信・即時抽選・後日抽選）
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  audience_filter TEXT,
  message_template_id TEXT,
  scheduled_at INTEGER,
  entry_start_at INTEGER,
  entry_end_at INTEGER,
  selection_method TEXT,
  win_probability REAL,
  winner_limit INTEGER,
  remaining_winner_slots INTEGER,
  winner_template_id TEXT,
  loser_template_id TEXT,
  winner_actions TEXT NOT NULL DEFAULT '[]',
  loser_actions TEXT NOT NULL DEFAULT '[]',
  entry_confirm_enabled INTEGER NOT NULL DEFAULT 0,
  entry_confirm_template_id TEXT,
  duplicate_action TEXT NOT NULL DEFAULT 'ignore',
  lock_token TEXT,
  locked_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER,
  completed_at INTEGER,
  paused_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (message_template_id) REFERENCES templates(id),
  FOREIGN KEY (winner_template_id) REFERENCES templates(id),
  FOREIGN KEY (loser_template_id) REFERENCES templates(id),
  FOREIGN KEY (entry_confirm_template_id) REFERENCES templates(id)
);
CREATE INDEX idx_campaigns_account ON campaigns(account_id, created_at);
CREATE INDEX idx_campaigns_status_schedule ON campaigns(status, scheduled_at) WHERE status IN ('scheduled', 'active', 'drawing');
CREATE INDEX idx_campaigns_status_entry ON campaigns(status, entry_end_at) WHERE status = 'active';

CREATE TABLE campaign_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  source_trigger_id TEXT,
  source_comment_id TEXT,
  source_comment_created_at INTEGER,
  result TEXT NOT NULL DEFAULT 'pending',
  result_reason TEXT,
  selected_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  UNIQUE(campaign_id, ig_user_id)
);
CREATE INDEX idx_entries_campaign_result ON campaign_entries(campaign_id, result);

CREATE TABLE campaign_dispatches (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  dispatch_kind TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'dm',
  comment_id TEXT,
  message_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  skip_reason TEXT,
  queued_at INTEGER,
  sent_at INTEGER,
  failed_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  UNIQUE(campaign_id, ig_user_id, dispatch_kind)
);
CREATE INDEX idx_dispatches_campaign_status ON campaign_dispatches(campaign_id, status);
CREATE INDEX idx_dispatches_pending ON campaign_dispatches(status, channel, account_id) WHERE status = 'pending';
