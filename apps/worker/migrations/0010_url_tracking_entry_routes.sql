-- URL Tracking & Entry Routes (Task 23.1, 23.2)

CREATE TABLE tracked_links (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  click_actions TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_tracked_links_account ON tracked_links(account_id);
CREATE UNIQUE INDEX idx_tracked_links_short_code ON tracked_links(short_code);
CREATE INDEX idx_tracked_links_source ON tracked_links(account_id, source_type, source_id);

CREATE TABLE link_clicks (
  id TEXT PRIMARY KEY,
  tracked_link_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ig_user_id TEXT,
  clicked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (tracked_link_id) REFERENCES tracked_links(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_link_clicks_link ON link_clicks(tracked_link_id);
CREATE INDEX idx_link_clicks_user ON link_clicks(ig_user_id) WHERE ig_user_id IS NOT NULL;
CREATE INDEX idx_link_clicks_account ON link_clicks(account_id, clicked_at);
CREATE INDEX idx_link_clicks_analytics ON link_clicks(account_id, tracked_link_id, ig_user_id);

CREATE TABLE entry_routes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  ref_code TEXT NOT NULL,
  name TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_entry_routes_ref ON entry_routes(account_id, ref_code);
CREATE INDEX idx_entry_routes_account ON entry_routes(account_id);

CREATE TABLE entry_route_events (
  id TEXT PRIMARY KEY,
  entry_route_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  ref_code TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (entry_route_id) REFERENCES entry_routes(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_entry_route_events_route ON entry_route_events(entry_route_id);
CREATE INDEX idx_entry_route_events_user ON entry_route_events(ig_user_id);
CREATE INDEX idx_entry_route_events_account ON entry_route_events(account_id, created_at);
CREATE INDEX idx_entry_route_events_analytics ON entry_route_events(account_id, entry_route_id, ig_user_id);
