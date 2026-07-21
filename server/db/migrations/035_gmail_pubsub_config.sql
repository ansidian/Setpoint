CREATE TABLE IF NOT EXISTS ea_gmail_pubsub_config (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  push_token_hash TEXT,
  token_disabled INTEGER NOT NULL DEFAULT 0 CHECK (token_disabled IN (0, 1)),
  last_tested_at INTEGER,
  last_succeeded_at INTEGER,
  last_failed_at INTEGER,
  error_code TEXT,
  updated_at INTEGER NOT NULL,
  CHECK (token_disabled = 0 OR push_token_hash IS NULL)
);
