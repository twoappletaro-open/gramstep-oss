ALTER TABLE forms ADD COLUMN completion_template_id TEXT;
ALTER TABLE forms ADD COLUMN archived_at INTEGER;

ALTER TABLE form_steps ADD COLUMN field_type TEXT NOT NULL DEFAULT 'free_input';
ALTER TABLE form_steps ADD COLUMN field_key TEXT;
ALTER TABLE form_steps ADD COLUMN answer_mode TEXT NOT NULL DEFAULT 'choice';
ALTER TABLE form_steps ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE form_answers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  answer_value TEXT NOT NULL,
  answer_label TEXT,
  answered_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (session_id) REFERENCES form_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES form_steps(id) ON DELETE CASCADE,
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_form_answers_form ON form_answers(form_id, answered_at DESC);
CREATE INDEX idx_form_answers_user ON form_answers(ig_user_id, answered_at DESC);
CREATE UNIQUE INDEX idx_form_answers_session_step ON form_answers(session_id, step_id);
