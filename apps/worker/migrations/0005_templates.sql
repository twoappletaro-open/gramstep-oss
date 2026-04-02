-- templates テーブル: メッセージテンプレートCRUD (Req 7.1-7.5)
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text', 'generic', 'quick_reply', 'media')),
  body TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_templates_account ON templates(account_id);
CREATE INDEX idx_templates_account_type ON templates(account_id, type);
