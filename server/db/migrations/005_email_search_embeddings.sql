CREATE TABLE IF NOT EXISTS ea_email_search_embeddings (
  uid TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  document_text TEXT NOT NULL,
  document_json TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL,
  embedding F32_BLOB(1536) NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (uid) REFERENCES ea_email_index(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_search_embeddings_user
  ON ea_email_search_embeddings(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_search_embeddings_identity
  ON ea_email_search_embeddings(user_id, document_version, embedding_model, embedding_dimensions);

CREATE INDEX IF NOT EXISTS idx_email_search_embeddings_account
  ON ea_email_search_embeddings(user_id, account_id);
