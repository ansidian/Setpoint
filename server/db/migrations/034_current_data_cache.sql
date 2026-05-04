CREATE TABLE IF NOT EXISTS ea_current_data_cache (
  user_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  payload_json TEXT,
  fetched_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'current',
  error_message TEXT,
  refresh_started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_current_data_cache_user_status
  ON ea_current_data_cache (user_id, status);
