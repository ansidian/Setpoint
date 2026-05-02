-- Durable per-account historical INBOX email backfill state.
CREATE TABLE IF NOT EXISTS ea_email_backfill_state (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  mailbox_scope TEXT NOT NULL DEFAULT 'inbox',
  status TEXT NOT NULL DEFAULT 'idle',
  target_days INTEGER,
  oldest_target_date TEXT,
  oldest_indexed_date TEXT,
  last_scanned_at TEXT,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  indexed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, account_id, mailbox_scope)
);

CREATE INDEX IF NOT EXISTS idx_email_backfill_state_user
  ON ea_email_backfill_state(user_id, mailbox_scope, status);
