CREATE TABLE IF NOT EXISTS ea_bills_mirror_state (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'needs_sync',
  actual_configured INTEGER NOT NULL DEFAULT 0,
  actual_budget_url TEXT,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  pending_refresh_at TEXT,
  refresh_started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ea_bill_schedule_mirror (
  user_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'bill',
  next_date TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, schedule_id)
);

CREATE INDEX IF NOT EXISTS idx_bill_schedule_mirror_user_next_date
  ON ea_bill_schedule_mirror(user_id, next_date);

CREATE TABLE IF NOT EXISTS ea_bill_occurrence_mirror (
  user_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'bill',
  paid INTEGER NOT NULL DEFAULT 0,
  open_action_disabled INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, occurrence_id)
);

CREATE INDEX IF NOT EXISTS idx_bill_occurrence_mirror_user_date
  ON ea_bill_occurrence_mirror(user_id, occurrence_date);

CREATE INDEX IF NOT EXISTS idx_bill_occurrence_mirror_schedule
  ON ea_bill_occurrence_mirror(user_id, schedule_id);
