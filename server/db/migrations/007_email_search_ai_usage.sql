CREATE TABLE IF NOT EXISTS ea_email_search_ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_search_ai_usage_user_created
  ON ea_email_search_ai_usage(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_search_ai_usage_user_event
  ON ea_email_search_ai_usage(user_id, event_type, created_at DESC);
