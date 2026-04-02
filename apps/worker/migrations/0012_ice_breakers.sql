-- Migration: 0012_ice_breakers
-- Phase 3: Ice Breakers管理 (Req 19.1, 19.2)

CREATE TABLE ice_breakers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  question TEXT NOT NULL,
  payload TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_synced INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_ice_breakers_account ON ice_breakers(account_id);
CREATE UNIQUE INDEX idx_ice_breakers_account_position ON ice_breakers(account_id, position);
CREATE UNIQUE INDEX idx_ice_breakers_account_payload ON ice_breakers(account_id, payload);
