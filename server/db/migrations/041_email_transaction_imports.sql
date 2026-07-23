CREATE TABLE IF NOT EXISTS ea_transaction_import_mappings (
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('amazon', 'paypal')),
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'observe', 'automatic')),
  actual_account_id TEXT,
  actual_category_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, source),
  FOREIGN KEY (user_id) REFERENCES ea_owner(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ea_transaction_import_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('historical_scan', 'arrival')),
  options_key TEXT NOT NULL,
  gmail_account_ids_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry', 'paused', 'completed', 'failed')),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  parsed_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  added_count INTEGER NOT NULL DEFAULT 0 CHECK (added_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token TEXT,
  claimed_at INTEGER,
  next_attempt_at INTEGER,
  last_error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, user_id),
  CHECK (
    (trigger = 'historical_scan' AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_date < end_date)
    OR (trigger = 'arrival' AND start_date IS NULL AND end_date IS NULL)
  ),
  CHECK ((claim_token IS NULL AND claimed_at IS NULL) OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)),
  FOREIGN KEY (user_id) REFERENCES ea_owner(user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_import_runs_active_historical
  ON ea_transaction_import_runs(user_id, options_key)
  WHERE trigger = 'historical_scan' AND status IN ('queued', 'running', 'retry', 'paused');

CREATE INDEX IF NOT EXISTS idx_transaction_import_runs_claim
  ON ea_transaction_import_runs(status, next_attempt_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_transaction_import_runs_owner_recent
  ON ea_transaction_import_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ea_transaction_import_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  gmail_account_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  email_uid TEXT NOT NULL,
  internet_message_id TEXT,
  candidate_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('amazon', 'paypal')),
  parser_version TEXT NOT NULL,
  external_id TEXT,
  imported_id TEXT,
  transaction_date TEXT,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents <> 0),
  currency TEXT,
  payee TEXT,
  notes TEXT NOT NULL DEFAULT '',
  actual_account_id TEXT,
  actual_category_id TEXT,
  automation_mode TEXT NOT NULL CHECK (automation_mode IN ('observe', 'automatic')),
  automatic_safe INTEGER NOT NULL DEFAULT 0 CHECK (automatic_safe IN (0, 1)),
  blocking_warnings_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (status IN (
      'needs_review', 'queued', 'reconciling', 'ready', 'importing',
      'added', 'updated', 'already_present', 'failed', 'paused', 'dismissed'
    )),
  reconciliation_status TEXT
    CHECK (reconciliation_status IS NULL OR reconciliation_status IN (
      'would_add', 'would_update', 'already_present', 'added', 'updated', 'failed'
    )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token TEXT,
  claimed_at INTEGER,
  next_attempt_at INTEGER,
  last_error TEXT,
  confirmed_at INTEGER,
  dismissed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (run_id, gmail_account_id, gmail_message_id, candidate_key),
  CHECK ((claim_token IS NULL AND claimed_at IS NULL) OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (automatic_safe = 0 OR (
    external_id IS NOT NULL AND imported_id IS NOT NULL AND transaction_date IS NOT NULL
    AND currency = 'USD' AND amount_cents < 0 AND payee IS NOT NULL
  )),
  FOREIGN KEY (run_id, user_id) REFERENCES ea_transaction_import_runs(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES ea_owner(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transaction_import_items_claim
  ON ea_transaction_import_items(status, next_attempt_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_transaction_import_items_run
  ON ea_transaction_import_items(user_id, run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_transaction_import_items_email
  ON ea_transaction_import_items(user_id, gmail_account_id, gmail_message_id);

CREATE INDEX IF NOT EXISTS idx_transaction_import_items_external
  ON ea_transaction_import_items(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_import_items_imported
  ON ea_transaction_import_items(user_id, imported_id)
  WHERE imported_id IS NOT NULL;
