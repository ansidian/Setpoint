ALTER TABLE ea_owner
  ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'password_or_passkey'
  CHECK (auth_mode IN ('password_or_passkey', 'password_plus_passkey'));

ALTER TABLE ea_sessions
  ADD COLUMN authenticated_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ea_owner_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  generated_at INTEGER NOT NULL,
  used_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_ea_owner_recovery_codes_user
  ON ea_owner_recovery_codes(user_id, used_at, generated_at);
