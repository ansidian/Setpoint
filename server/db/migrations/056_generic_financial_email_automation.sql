ALTER TABLE ea_transaction_import_items RENAME TO ea_transaction_import_items_before_automation;

CREATE TABLE ea_transaction_import_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  gmail_account_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  email_uid TEXT NOT NULL,
  internet_message_id TEXT,
  candidate_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('amazon', 'paypal', 'generic')),
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
  email_subject TEXT NOT NULL DEFAULT '',
  financial_email_plan_json TEXT,
  financial_plan_shadow_json TEXT,
  UNIQUE (run_id, gmail_account_id, gmail_message_id, candidate_key),
  CHECK ((claim_token IS NULL AND claimed_at IS NULL) OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (automatic_safe = 0 OR (
    external_id IS NOT NULL AND imported_id IS NOT NULL
    AND transaction_date IS NOT NULL AND currency = 'USD' AND amount_cents < 0 AND payee IS NOT NULL
    AND (source <> 'generic' OR (actual_account_id IS NOT NULL AND financial_email_plan_json IS NOT NULL))
  )),
  FOREIGN KEY (run_id, user_id) REFERENCES ea_transaction_import_runs(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES ea_owner(user_id) ON DELETE CASCADE
);

INSERT INTO ea_transaction_import_items (
  id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid,
  internet_message_id, candidate_key, source, parser_version, external_id,
  imported_id, transaction_date, amount_cents, currency, payee, notes,
  actual_account_id, actual_category_id, automation_mode, automatic_safe,
  blocking_warnings_json, evidence_json, status, reconciliation_status,
  attempts, claim_token, claimed_at, next_attempt_at, last_error, confirmed_at,
  dismissed_at, created_at, updated_at, email_subject,
  financial_email_plan_json, financial_plan_shadow_json
)
SELECT
  id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid,
  internet_message_id, candidate_key, source, parser_version, external_id,
  imported_id, transaction_date, amount_cents, currency, payee, notes,
  actual_account_id, actual_category_id, automation_mode, automatic_safe,
  blocking_warnings_json, evidence_json, status, reconciliation_status,
  attempts, claim_token, claimed_at, next_attempt_at, last_error, confirmed_at,
  dismissed_at, created_at, updated_at, email_subject,
  financial_email_plan_json, financial_plan_shadow_json
FROM ea_transaction_import_items_before_automation;

DROP TABLE ea_transaction_import_items_before_automation;

CREATE INDEX idx_transaction_import_items_claim
  ON ea_transaction_import_items(status, next_attempt_at, updated_at);
CREATE INDEX idx_transaction_import_items_run
  ON ea_transaction_import_items(user_id, run_id, created_at);
CREATE INDEX idx_transaction_import_items_email
  ON ea_transaction_import_items(user_id, gmail_account_id, gmail_message_id);
CREATE INDEX idx_transaction_import_items_external
  ON ea_transaction_import_items(user_id, source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_transaction_import_items_imported
  ON ea_transaction_import_items(user_id, imported_id)
  WHERE imported_id IS NOT NULL;
CREATE UNIQUE INDEX idx_transaction_import_items_generic_identity
  ON ea_transaction_import_items(user_id, imported_id)
  WHERE source = 'generic' AND imported_id IS NOT NULL;
