-- Only arrivals received and first indexed after deployment enter this workflow.
-- Existing indexed mail is deliberately not backfilled, even when re-fetched.
CREATE TABLE ea_financial_workflow_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  cutover_at TEXT NOT NULL
);
INSERT INTO ea_financial_workflow_state (singleton_id, cutover_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

CREATE TABLE ea_financial_intake_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  completed_through TEXT NOT NULL,
  window_end TEXT,
  page_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'waiting', 'retry')),
  next_attempt_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claim_token TEXT,
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, account_id),
  CHECK ((status = 'processing') = (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE INDEX idx_financial_intake_due ON ea_financial_intake_state(enabled, status, next_attempt_at);

CREATE TABLE ea_financial_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'waiting', 'settled', 'needs_review')),
  plan_json TEXT CHECK (plan_json IS NULL OR json_valid(plan_json)),
  owner_completion_json TEXT CHECK (owner_completion_json IS NULL OR json_valid(owner_completion_json)),
  operation_json TEXT CHECK (operation_json IS NULL OR json_valid(operation_json)),
  attempted_at INTEGER,
  outcome_json TEXT CHECK (outcome_json IS NULL OR json_valid(outcome_json)),
  reason TEXT,
  collection_deadline INTEGER,
  next_attempt_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, id),
  CHECK ((operation_json IS NULL) = (attempted_at IS NULL)),
  CHECK ((status = 'processing') = (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE INDEX idx_financial_events_due ON ea_financial_events(status, next_attempt_at, created_at);

-- A processor receipt and a merchant receipt may carry different references for
-- one event. Keep every grounded alias after source changes and beyond the local
-- complementary-evidence correlation window.
CREATE TABLE ea_financial_event_references (
  user_id TEXT NOT NULL,
  reference_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (user_id, reference_key),
  FOREIGN KEY (user_id, event_id) REFERENCES ea_financial_events(user_id, id)
);

CREATE TABLE ea_financial_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email_uid TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  processed_revision INTEGER NOT NULL DEFAULT 0,
  owner_confirmation_conflict INTEGER NOT NULL DEFAULT 0 CHECK (owner_confirmation_conflict IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'ignored', 'associated')),
  content_hash TEXT,
  candidate_json TEXT CHECK (candidate_json IS NULL OR json_valid(candidate_json)),
  event_id TEXT,
  next_attempt_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claim_token TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, email_uid),
  FOREIGN KEY (user_id, event_id) REFERENCES ea_financial_events(user_id, id),
  CHECK (processed_revision >= 0 AND processed_revision <= revision),
  CHECK ((status = 'processing') = (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE INDEX idx_financial_documents_due ON ea_financial_documents(status, next_attempt_at, created_at);
CREATE INDEX idx_financial_documents_event ON ea_financial_documents(user_id, event_id);

CREATE TRIGGER financial_document_arrival
AFTER INSERT ON ea_email_index
WHEN julianday(NEW.email_date_utc) >= julianday((SELECT cutover_at FROM ea_financial_workflow_state WHERE singleton_id = 1))
  AND julianday(NEW.indexed_at) >= julianday((SELECT cutover_at FROM ea_financial_workflow_state WHERE singleton_id = 1))
BEGIN
  INSERT INTO ea_financial_documents (user_id, account_id, email_uid, created_at, updated_at)
  VALUES (NEW.user_id, NEW.account_id, NEW.uid, unixepoch('now') * 1000, unixepoch('now') * 1000)
  ON CONFLICT(user_id, email_uid) DO NOTHING;
END;

-- Read flags, volatile snippets, and authentication evaluation timestamps do not
-- change decision evidence. An update only revisits an already admitted arrival.
CREATE TRIGGER financial_document_evidence_changed
AFTER UPDATE ON ea_email_index
WHEN OLD.from_name IS NOT NEW.from_name
  OR OLD.from_address IS NOT NEW.from_address
  OR OLD.subject IS NOT NEW.subject
  OR OLD.body_text IS NOT NEW.body_text
  OR OLD.email_date_utc IS NOT NEW.email_date_utc
  OR OLD.thread_id IS NOT NEW.thread_id
  OR OLD.message_id IS NOT NEW.message_id
  OR (CASE WHEN json_valid(OLD.sender_authentication_json)
        THEN json_remove(OLD.sender_authentication_json, '$.evaluatedAt') ELSE OLD.sender_authentication_json END)
     IS NOT (CASE WHEN json_valid(NEW.sender_authentication_json)
        THEN json_remove(NEW.sender_authentication_json, '$.evaluatedAt') ELSE NEW.sender_authentication_json END)
BEGIN
  UPDATE ea_financial_documents
  SET revision = revision + 1,
      status = CASE WHEN status = 'processing' THEN status ELSE 'pending' END,
      attempts = CASE WHEN status = 'processing' THEN attempts ELSE 0 END,
      next_attempt_at = NULL,
      last_error = NULL,
      updated_at = unixepoch('now') * 1000
  WHERE user_id = NEW.user_id AND email_uid = NEW.uid;

  UPDATE ea_financial_events
  SET revision = revision + 1,
      status = CASE WHEN status = 'processing' THEN status ELSE 'pending' END,
      next_attempt_at = NULL,
      updated_at = unixepoch('now') * 1000
  WHERE user_id = NEW.user_id
    AND id = (SELECT event_id FROM ea_financial_documents WHERE user_id = NEW.user_id AND email_uid = NEW.uid);
END;

-- Once dispatch is admitted, every retry must reconcile the same payload.
CREATE TRIGGER financial_operation_immutable
BEFORE UPDATE OF operation_json, attempted_at, owner_completion_json ON ea_financial_events
WHEN OLD.attempted_at IS NOT NULL
  AND (NEW.operation_json IS NOT OLD.operation_json OR NEW.attempted_at IS NOT OLD.attempted_at
    OR NEW.owner_completion_json IS NOT OLD.owner_completion_json)
BEGIN
  SELECT RAISE(ABORT, 'An attempted financial operation is immutable');
END;
CREATE TRIGGER financial_attempt_history_retained
BEFORE DELETE ON ea_financial_events
WHEN OLD.attempted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Attempted financial operation history must be retained');
END;
