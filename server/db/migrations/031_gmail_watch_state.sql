-- Gmail Pub/Sub watch state and history cursor per Gmail account.

CREATE TABLE IF NOT EXISTS ea_gmail_watch_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email_address TEXT NOT NULL,
  last_history_id TEXT,
  watch_expiration_at TEXT,
  watch_status TEXT NOT NULL DEFAULT 'inactive',
  last_notification_at TEXT,
  last_renewed_at TEXT,
  last_sync_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_watch_state_expiration
  ON ea_gmail_watch_state(watch_status, watch_expiration_at);

CREATE INDEX IF NOT EXISTS idx_gmail_watch_state_email
  ON ea_gmail_watch_state(lower(email_address));
