-- Inbox sweeps alone own these timestamps: neither mailbox contents nor account
-- creation prove a successful provider check. Existing accounts begin unknown.
CREATE TABLE ea_email_sync_health (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  last_success_at TEXT,
  last_failed_at TEXT,
  refresh_started_at TEXT,
  PRIMARY KEY (user_id, account_id),
  FOREIGN KEY (account_id) REFERENCES ea_accounts(id) ON DELETE CASCADE
);
