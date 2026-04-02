-- Migration: 0011_reminders
-- Phase 3 リマインダー配信テーブル (Req 16.1-16.4)

CREATE TABLE reminders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX idx_reminders_account ON reminders(account_id);

CREATE TABLE reminder_steps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  reminder_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  offset_seconds INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  message_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (reminder_id) REFERENCES reminders(id)
);

CREATE INDEX idx_reminder_steps_reminder ON reminder_steps(reminder_id, step_order);

CREATE TABLE reminder_enrollments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  reminder_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  base_date INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (reminder_id) REFERENCES reminders(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (ig_user_id) REFERENCES ig_users(id)
);

CREATE INDEX idx_reminder_enrollments_account_status ON reminder_enrollments(account_id, status);
CREATE INDEX idx_reminder_enrollments_reminder_user ON reminder_enrollments(reminder_id, ig_user_id, status);

CREATE TABLE reminder_delivery_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  enrollment_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  UNIQUE(enrollment_id, step_id),
  FOREIGN KEY (enrollment_id) REFERENCES reminder_enrollments(id),
  FOREIGN KEY (step_id) REFERENCES reminder_steps(id)
);
