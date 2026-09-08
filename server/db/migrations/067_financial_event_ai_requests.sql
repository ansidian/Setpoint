-- A reservation is a potentially billed attempt, including a lost response.
-- Exact request fingerprints retain completed results across event retries.
CREATE TABLE IF NOT EXISTS ea_financial_event_ai_requests (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished_at INTEGER,
  fields_json TEXT CHECK (fields_json IS NULL OR json_valid(fields_json)),
  UNIQUE (user_id, event_id, request_key, attempt),
  FOREIGN KEY (user_id, event_id) REFERENCES ea_financial_events(user_id, id)
);

-- Assessment can fail before an event exists. Count only admitted assessments,
-- not paused ticks, authentication waits or event planning attempts.
CREATE TABLE IF NOT EXISTS ea_financial_document_ai_attempts (
  user_id TEXT NOT NULL,
  document_id INTEGER NOT NULL REFERENCES ea_financial_documents(id),
  content_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  PRIMARY KEY (user_id, document_id, content_hash)
);
