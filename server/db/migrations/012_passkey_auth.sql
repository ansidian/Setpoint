CREATE TABLE IF NOT EXISTS ea_passkey_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT DEFAULT '[]',
  backed_up INTEGER DEFAULT NULL,
  credential_device_type TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_ea_passkey_credentials_user
  ON ea_passkey_credentials(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ea_pending_auth (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ea_pending_auth_user_expires
  ON ea_pending_auth(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_ea_pending_auth_expires
  ON ea_pending_auth(expires_at);

CREATE TABLE IF NOT EXISTS ea_webauthn_challenges (
  challenge_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  challenge_type TEXT NOT NULL,
  pending_auth_hash TEXT DEFAULT NULL,
  credential_id TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (challenge_type IN ('authentication', 'registration'))
);

CREATE INDEX IF NOT EXISTS idx_ea_webauthn_challenges_user_type
  ON ea_webauthn_challenges(user_id, challenge_type, expires_at);

CREATE INDEX IF NOT EXISTS idx_ea_webauthn_challenges_expires
  ON ea_webauthn_challenges(expires_at);
