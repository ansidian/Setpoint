CREATE TABLE IF NOT EXISTS ea_email_search_embedding_state (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  mode TEXT NOT NULL DEFAULT 'fallback',
  total_indexed INTEGER NOT NULL DEFAULT 0,
  fresh_embeddings INTEGER NOT NULL DEFAULT 0,
  stale_embeddings INTEGER NOT NULL DEFAULT 0,
  missing_embeddings INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_started_at TEXT,
  last_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
