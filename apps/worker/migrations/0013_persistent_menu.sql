-- Migration: 0013_persistent_menu
-- Phase 3: Persistent Menu管理 (Req 19.3, 19.4)

CREATE TABLE persistent_menu_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('web_url', 'postback')),
  title TEXT NOT NULL,
  url TEXT,
  payload TEXT,
  position INTEGER NOT NULL,
  is_synced INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CHECK (
    (type = 'web_url' AND url IS NOT NULL AND payload IS NULL) OR
    (type = 'postback' AND payload IS NOT NULL AND url IS NULL)
  )
);

CREATE INDEX idx_persistent_menu_account ON persistent_menu_items(account_id);
CREATE UNIQUE INDEX idx_persistent_menu_account_position ON persistent_menu_items(account_id, position);
