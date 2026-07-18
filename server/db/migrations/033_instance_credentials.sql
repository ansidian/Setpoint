CREATE TABLE IF NOT EXISTS ea_instance_credentials (
  credential_key TEXT PRIMARY KEY,
  active_value_encrypted TEXT,
  pending_value_encrypted TEXT,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  validation_state TEXT NOT NULL DEFAULT 'untested'
    CHECK (validation_state IN ('untested', 'pending', 'valid', 'invalid', 'disabled')),
  last_tested_at INTEGER,
  last_succeeded_at INTEGER,
  last_failed_at INTEGER,
  error_code TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  CHECK (disabled = 0 OR active_value_encrypted IS NULL)
);
