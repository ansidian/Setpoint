DROP TABLE IF EXISTS ea_notes;

CREATE TABLE IF NOT EXISTS ea_tldraw_documents (
  user_id TEXT PRIMARY KEY,
  document_gzip BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
