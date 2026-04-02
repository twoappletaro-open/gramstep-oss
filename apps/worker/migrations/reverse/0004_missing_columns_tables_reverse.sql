-- 0004_missing_columns_tables_reverse.sql
-- Reverse migration: drop added columns and tables

-- Drop tables (reverse order of creation)
DROP INDEX IF EXISTS idx_automation_rules_account;
DROP TABLE IF EXISTS automation_rules;

DROP INDEX IF EXISTS idx_api_keys_hash;
DROP INDEX IF EXISTS idx_api_keys_account;
DROP TABLE IF EXISTS api_keys;

-- Drop added columns
-- Note: SQLite does not support DROP COLUMN before 3.35.0.
-- D1 uses a recent SQLite version that supports ALTER TABLE DROP COLUMN.
ALTER TABLE message_logs DROP COLUMN is_deleted;

ALTER TABLE webhook_events DROP COLUMN response_time_ms;

ALTER TABLE ig_users DROP COLUMN control_mode;
ALTER TABLE ig_users DROP COLUMN assigned_operator_id;
ALTER TABLE ig_users DROP COLUMN custom_status_label;
ALTER TABLE ig_users DROP COLUMN conversation_status;
