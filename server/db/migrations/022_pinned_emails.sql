CREATE TABLE IF NOT EXISTS ea_pinned_emails (
  user_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  account_id TEXT,
  pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
  email_snapshot TEXT,
  PRIMARY KEY (user_id, email_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_emails_user
  ON ea_pinned_emails (user_id, pinned_at);
