CREATE TABLE ea_email_remote_content_trust (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  sender_address TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, account_id, sender_address)
);

CREATE INDEX idx_email_remote_content_trust_user
  ON ea_email_remote_content_trust(user_id, created_at DESC);
