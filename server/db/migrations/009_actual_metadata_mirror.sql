CREATE TABLE IF NOT EXISTS ea_actual_metadata_mirror (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'needs_sync',
  accounts_json TEXT NOT NULL DEFAULT '[]',
  payees_json TEXT NOT NULL DEFAULT '[]',
  categories_json TEXT NOT NULL DEFAULT '[]',
  schedules_json TEXT NOT NULL DEFAULT '[]',
  recent_transactions_json TEXT NOT NULL DEFAULT '[]',
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
