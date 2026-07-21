ALTER TABLE ea_settings ADD COLUMN todoist_connection_mode TEXT;

UPDATE ea_settings
SET todoist_connection_mode = CASE
  WHEN todoist_api_token_encrypted IS NULL THEN NULL
  WHEN todoist_oauth_refresh_token_encrypted IS NOT NULL THEN 'oauth'
  ELSE 'personal_token'
END
WHERE todoist_connection_mode IS NULL;

CREATE TABLE IF NOT EXISTS ea_todoist_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  browser_bind_hash TEXT NOT NULL,
  client_id_version INTEGER,
  client_secret_version INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todoist_oauth_states_expires
  ON ea_todoist_oauth_states(expires_at);
