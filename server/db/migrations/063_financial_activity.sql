-- Source identity and evidence are separate from the mutable processing queues.
CREATE TABLE ea_financial_activity_occurrences (
  user_id TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('event', 'import')),
  record_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  run_id TEXT,
  source TEXT NOT NULL,
  original_imported_id TEXT,
  source_snapshot_json TEXT NOT NULL CHECK (json_valid(source_snapshot_json)),
  PRIMARY KEY (user_id, owner, record_id)
);
CREATE TABLE ea_financial_identity_conflicts (
  user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  occurrence_activity_id TEXT NOT NULL,
  imported_activity_id TEXT NOT NULL,
  PRIMARY KEY (user_id, record_id)
);
CREATE TABLE ea_financial_activity_aliases (
  user_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  PRIMARY KEY (user_id, alias_key)
);
CREATE INDEX idx_financial_activity_occurrences ON ea_financial_activity_occurrences(user_id, activity_id);
CREATE TABLE ea_financial_original_receipts (
  user_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER,
  captured_at INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  input_json TEXT CHECK (input_json IS NULL OR json_valid(input_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  capture_kind TEXT NOT NULL CHECK (capture_kind IN ('settlement', 'historical')),
  PRIMARY KEY (user_id, owner, record_id),
  FOREIGN KEY (user_id, owner, record_id) REFERENCES ea_financial_activity_occurrences(user_id, owner, record_id)
);
CREATE TABLE ea_financial_actual_bindings (
  user_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  budget_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  role TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  PRIMARY KEY (user_id, activity_id, budget_id, kind, object_id, role)
);
ALTER TABLE ea_transaction_import_items ADD COLUMN actual_result_json TEXT CHECK (actual_result_json IS NULL OR json_valid(actual_result_json));
ALTER TABLE ea_transaction_import_items ADD COLUMN prepared_actual_json TEXT CHECK (prepared_actual_json IS NULL OR json_valid(prepared_actual_json));
ALTER TABLE ea_transaction_import_items ADD COLUMN original_attempted_at INTEGER;
CREATE TRIGGER financial_import_preparation_immutable BEFORE UPDATE ON ea_transaction_import_items
WHEN OLD.original_attempted_at IS NOT NULL AND
  (NEW.prepared_actual_json IS NOT OLD.prepared_actual_json OR NEW.original_attempted_at IS NOT OLD.original_attempted_at)
BEGIN SELECT RAISE(ABORT, 'Attempted original import preparation is immutable'); END;
CREATE TABLE ea_financial_identity_backfill AS SELECT * FROM ea_transaction_import_items WHERE 0;
CREATE TRIGGER financial_identity_backfill AFTER INSERT ON ea_financial_identity_backfill BEGIN
INSERT INTO ea_financial_identity_conflicts (user_id, record_id, occurrence_activity_id, imported_activity_id)
SELECT NEW.user_id, NEW.id, occurrence.activity_id, imported.activity_id
FROM ea_financial_activity_aliases occurrence JOIN ea_financial_activity_aliases imported ON imported.user_id = occurrence.user_id
WHERE occurrence.user_id = NEW.user_id
  AND occurrence.alias_key = json_array('occurrence', NEW.source, NEW.gmail_account_id, NEW.gmail_message_id, NEW.candidate_key)
  AND imported.alias_key = json_array('imported', NEW.source, NEW.imported_id)
  AND occurrence.activity_id <> imported.activity_id;
INSERT INTO ea_financial_activity_occurrences
  (user_id, owner, record_id, activity_id, run_id, source, original_imported_id, source_snapshot_json)
VALUES (NEW.user_id, 'import', NEW.id, COALESCE((SELECT json_array('identity-conflict', NEW.id) FROM ea_financial_identity_conflicts WHERE user_id = NEW.user_id AND record_id = NEW.id), (SELECT activity_id FROM ea_financial_activity_aliases WHERE user_id = NEW.user_id AND alias_key = json_array('occurrence', NEW.source, NEW.gmail_account_id, NEW.gmail_message_id, NEW.candidate_key)), (SELECT activity_id FROM ea_financial_activity_aliases WHERE user_id = NEW.user_id AND alias_key = json_array('imported', NEW.source, NEW.imported_id) AND NEW.imported_id IS NOT NULL), CASE WHEN NEW.imported_id IS NOT NULL THEN json_array('import', NEW.source, NEW.imported_id) ELSE json_array('import-item', NEW.id) END), NEW.run_id, NEW.source, NEW.imported_id,
  json_object('emailUid', NEW.email_uid, 'candidateKey', NEW.candidate_key, 'importedId', NEW.imported_id,
    'date', NEW.transaction_date, 'amountCents', NEW.amount_cents, 'payee', NEW.payee,
    'accountId', NEW.actual_account_id, 'categoryId', NEW.actual_category_id, 'evidence', json(NEW.evidence_json)));
INSERT INTO ea_financial_activity_aliases (user_id, alias_key, activity_id)
SELECT NEW.user_id, json_array('occurrence', NEW.source, NEW.gmail_account_id, NEW.gmail_message_id, NEW.candidate_key), activity_id FROM ea_financial_activity_occurrences
WHERE user_id = NEW.user_id AND owner = 'import' AND record_id = NEW.id
ON CONFLICT(user_id, alias_key) DO NOTHING;
INSERT INTO ea_financial_activity_aliases (user_id, alias_key, activity_id)
SELECT NEW.user_id, json_array('imported', NEW.source, NEW.imported_id), activity_id FROM ea_financial_activity_occurrences
WHERE user_id = NEW.user_id AND owner = 'import' AND record_id = NEW.id AND NEW.imported_id IS NOT NULL
ON CONFLICT(user_id, alias_key) DO NOTHING;
END;
INSERT INTO ea_financial_identity_backfill SELECT * FROM ea_transaction_import_items ORDER BY created_at, id;
DROP TABLE ea_financial_identity_backfill;
CREATE TRIGGER financial_import_identity AFTER INSERT ON ea_transaction_import_items BEGIN
INSERT INTO ea_financial_identity_conflicts (user_id, record_id, occurrence_activity_id, imported_activity_id)
SELECT NEW.user_id, NEW.id, occurrence.activity_id, imported.activity_id
FROM ea_financial_activity_aliases occurrence JOIN ea_financial_activity_aliases imported ON imported.user_id = occurrence.user_id
WHERE occurrence.user_id = NEW.user_id
  AND occurrence.alias_key = json_array('occurrence', NEW.source, NEW.gmail_account_id, NEW.gmail_message_id, NEW.candidate_key)
  AND imported.alias_key = json_array('imported', NEW.source, NEW.imported_id)
  AND occurrence.activity_id <> imported.activity_id;
INSERT INTO ea_financial_activity_occurrences
  (user_id, owner, record_id, activity_id, run_id, source, original_imported_id, source_snapshot_json)
VALUES (NEW.user_id, 'import', NEW.id, COALESCE((SELECT json_array('identity-conflict', NEW.id) FROM ea_financial_identity_conflicts WHERE user_id = NEW.user_id AND record_id = NEW.id), (SELECT activity_id FROM ea_financial_activity_aliases WHERE user_id = NEW.user_id AND alias_key = json_array('occurrence', NEW.source, NEW.gmail_account_id, NEW.gmail_message_id, NEW.candidate_key)), (SELECT activity_id FROM ea_financial_activity_aliases WHERE user_id = NEW.user_id AND alias_key = json_array('imported', NEW.source, NEW.imported_id) AND NEW.imported_id IS NOT NULL), CASE WHEN NEW.imported_id IS NOT NULL THEN json_array('import', NEW.source, NEW.imported_id) ELSE json_array('import-item', NEW.id) END), NEW.run_id, NEW.source, NEW.imported_id,
  json_object('emailUid', NEW.email_uid, 'candidateKey', NEW.candidate_key, 'importedId', NEW.imported_id,
    'date', NEW.transaction_date, 'amountCents', NEW.amount_cents, 'payee', NEW.payee,
    'accountId', NEW.actual_account_id, 'categoryId', NEW.actual_category_id, 'evidence', json(NEW.evidence_json)));
INSERT INTO ea_financial_activity_aliases (user_id, alias_key, activity_id)
SELECT NEW.user_id, json_array('occurrence', NEW.source, NEW.gmail_account_id, NEW.gmail_message_id, NEW.candidate_key), activity_id FROM ea_financial_activity_occurrences
WHERE user_id = NEW.user_id AND owner = 'import' AND record_id = NEW.id
ON CONFLICT(user_id, alias_key) DO NOTHING;
INSERT INTO ea_financial_activity_aliases (user_id, alias_key, activity_id)
SELECT NEW.user_id, json_array('imported', NEW.source, NEW.imported_id), activity_id FROM ea_financial_activity_occurrences
WHERE user_id = NEW.user_id AND owner = 'import' AND record_id = NEW.id AND NEW.imported_id IS NOT NULL
ON CONFLICT(user_id, alias_key) DO NOTHING;
UPDATE ea_transaction_import_items SET status = 'needs_review', automatic_safe = 0,
  last_error = 'Original financial identity aliases conflict; resolve the exact source before importing.'
WHERE user_id = NEW.user_id AND id = NEW.id
  AND EXISTS (SELECT 1 FROM ea_financial_identity_conflicts WHERE user_id = NEW.user_id AND record_id = NEW.id);
END;
INSERT INTO ea_financial_activity_occurrences (user_id, owner, record_id, activity_id, source, source_snapshot_json) SELECT user_id, 'event', id, json_array('event', id), 'managed', '{}' FROM ea_financial_events;
CREATE TRIGGER financial_event_identity AFTER INSERT ON ea_financial_events BEGIN
INSERT INTO ea_financial_activity_occurrences
(user_id, owner, record_id, activity_id, source, source_snapshot_json)
VALUES (NEW.user_id, 'event', NEW.id, json_array('event', NEW.id), 'managed', '{}');
END;
CREATE TRIGGER financial_event_receipt AFTER UPDATE ON ea_financial_events
WHEN json_extract(NEW.outcome_json, '$.outcome') IN ('added', 'updated', 'already_present')
BEGIN
  INSERT OR IGNORE INTO ea_financial_original_receipts
  (user_id, owner, record_id, revision, captured_at, outcome, input_json, result_json, capture_kind)
  VALUES (NEW.user_id, 'event', NEW.id, NEW.revision, NEW.updated_at,
    json_extract(NEW.outcome_json, '$.outcome'), json_object('operation', json(NEW.operation_json), 'plan', json(NEW.plan_json),
      'sources', COALESCE(json_extract(NEW.operation_json, '$.sourceEvidence'), (SELECT json_group_array(json_object(
        'emailUid', d.email_uid, 'revision', d.revision, 'contentHash', d.content_hash, 'candidate', json(d.candidate_json)))
        FROM ea_financial_documents d WHERE d.user_id = NEW.user_id AND d.event_id = NEW.id))), NEW.outcome_json, 'settlement');
END;
CREATE TRIGGER financial_import_receipt AFTER UPDATE ON ea_transaction_import_items
WHEN NEW.status IN ('added', 'updated', 'already_present')
BEGIN
  INSERT OR IGNORE INTO ea_financial_original_receipts
  (user_id, owner, record_id, captured_at, outcome, input_json, result_json, capture_kind)
  VALUES (NEW.user_id, 'import', NEW.id, NEW.updated_at, NEW.status,
    json_object('date', NEW.transaction_date, 'amountCents', NEW.amount_cents, 'payee', NEW.payee,
      'accountId', NEW.actual_account_id, 'categoryId', NEW.actual_category_id, 'importedId', NEW.imported_id,
      'plan', json(NEW.financial_email_plan_json)), NEW.actual_result_json, 'settlement');
END;
-- Older records retain only the evidence that was actually saved; no before-images are invented.
INSERT INTO ea_financial_original_receipts
(user_id, owner, record_id, revision, captured_at, outcome, input_json, result_json, capture_kind)
SELECT user_id, 'event', id, revision, updated_at, json_extract(outcome_json, '$.outcome'),
  COALESCE(operation_json, plan_json), outcome_json, 'historical'
FROM ea_financial_events WHERE json_extract(outcome_json, '$.outcome') IN ('added', 'updated', 'already_present');
INSERT INTO ea_financial_original_receipts
(user_id, owner, record_id, captured_at, outcome, input_json, result_json, capture_kind)
SELECT user_id, 'import', id, updated_at, status, financial_email_plan_json, actual_result_json, 'historical'
FROM ea_transaction_import_items WHERE status IN ('added', 'updated', 'already_present');
CREATE TRIGGER financial_receipt_bindings AFTER INSERT ON ea_financial_original_receipts
WHEN json_extract(NEW.result_json, '$.evidence.budgetId') IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO ea_financial_actual_bindings
    (user_id, activity_id, budget_id, kind, object_id, role, evidence_json)
  SELECT NEW.user_id, occurrence.activity_id, json_extract(NEW.result_json, '$.evidence.budgetId'),
    json_extract(object.value, '$.kind'), json_extract(object.value, '$.id'),
    json_extract(object.value, '$.role'), object.value
  FROM ea_financial_activity_occurrences occurrence, json_each(NEW.result_json, '$.evidence.objects') object
  WHERE occurrence.user_id = NEW.user_id AND occurrence.owner = NEW.owner AND occurrence.record_id = NEW.record_id;
END;
CREATE TRIGGER ea_financial_activity_occurrences_update_immutable BEFORE UPDATE ON ea_financial_activity_occurrences
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER ea_financial_activity_occurrences_delete_immutable BEFORE DELETE ON ea_financial_activity_occurrences
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER ea_financial_activity_aliases_update_immutable BEFORE UPDATE ON ea_financial_activity_aliases
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER ea_financial_activity_aliases_delete_immutable BEFORE DELETE ON ea_financial_activity_aliases
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER ea_financial_original_receipts_update_immutable BEFORE UPDATE ON ea_financial_original_receipts
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER ea_financial_original_receipts_delete_immutable BEFORE DELETE ON ea_financial_original_receipts
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER ea_financial_actual_bindings_update_immutable BEFORE UPDATE ON ea_financial_actual_bindings
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER ea_financial_actual_bindings_delete_immutable BEFORE DELETE ON ea_financial_actual_bindings
BEGIN SELECT RAISE(ABORT, 'Original financial identity and evidence are immutable'); END;
CREATE TRIGGER financial_identity_conflict_update_immutable BEFORE UPDATE ON ea_financial_identity_conflicts
BEGIN SELECT RAISE(ABORT, 'Original financial identity conflicts are immutable'); END;
CREATE TRIGGER financial_identity_conflict_delete_immutable BEFORE DELETE ON ea_financial_identity_conflicts
BEGIN SELECT RAISE(ABORT, 'Original financial identity conflicts are immutable'); END;
