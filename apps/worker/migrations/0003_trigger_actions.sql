-- Private Reply送信済みコメント追跡（重複防止）
CREATE TABLE private_replies_sent (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_private_replies_comment ON private_replies_sent(comment_id);
CREATE INDEX idx_private_replies_account ON private_replies_sent(account_id);

-- コメント/ストーリー起点DM 24時間制限追跡
CREATE TABLE comment_dm_limits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_comment_dm_limits_lookup ON comment_dm_limits(account_id, ig_user_id, sent_at);
