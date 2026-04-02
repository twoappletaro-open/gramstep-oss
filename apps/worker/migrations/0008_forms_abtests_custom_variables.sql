-- フォーム定義
CREATE TABLE forms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_forms_account ON forms(account_id);

-- フォームステップ（Quick Reply連鎖）
CREATE TABLE form_steps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  form_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  quick_replies TEXT NOT NULL DEFAULT '[]', -- JSON array of {title, payload, metadata_key?}
  metadata_key TEXT, -- 回答を保存するメタデータキー
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_form_steps_order ON form_steps(form_id, step_order);

-- フォーム回答セッション
CREATE TABLE form_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  form_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  current_step_order INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'completed', 'abandoned'
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_form_sessions_user ON form_sessions(ig_user_id, status);

-- A/Bテスト
CREATE TABLE ab_tests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);
CREATE INDEX idx_ab_tests_template ON ab_tests(template_id);

-- A/Bテストバリアント（最大3）
CREATE TABLE ab_test_variants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ab_test_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  sent_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  cv_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (ab_test_id) REFERENCES ab_tests(id) ON DELETE CASCADE
);
CREATE INDEX idx_ab_variants_test ON ab_test_variants(ab_test_id);

-- A/Bテストイベントログ（クリック・CV重複排除用）
CREATE TABLE ab_test_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  variant_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'click', 'conversion'
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (variant_id) REFERENCES ab_test_variants(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_ab_events_unique ON ab_test_events(variant_id, ig_user_id, event_type);

-- カスタム変数
CREATE TABLE custom_variables (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  default_value TEXT NOT NULL DEFAULT '',
  data_source TEXT NOT NULL DEFAULT 'static', -- 'metadata', 'tag', 'score', 'static'
  metadata_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_custom_vars_account_name ON custom_variables(account_id, name);
