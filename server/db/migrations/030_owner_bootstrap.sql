CREATE TABLE IF NOT EXISTS ea_owner (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  user_id TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
