CREATE TABLE ea_financial_correction_previews (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, activity_id TEXT NOT NULL,
  preview_json TEXT NOT NULL CHECK(json_valid(preview_json)), created_at INTEGER NOT NULL
);
CREATE TABLE ea_financial_corrections (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, activity_id TEXT NOT NULL, budget_id TEXT NOT NULL,
  preview_id TEXT NOT NULL REFERENCES ea_financial_correction_previews(id),
  idempotency_key TEXT NOT NULL, predecessor_id TEXT REFERENCES ea_financial_corrections(id),
  state TEXT NOT NULL CHECK(state IN ('applying','recovering','attention','completed','superseded')),
  execution_stopped INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
  invalidation_pending INTEGER NOT NULL DEFAULT 0, effective_result_json TEXT, updated_at INTEGER NOT NULL,
  UNIQUE(user_id, idempotency_key), UNIQUE(preview_id), UNIQUE(predecessor_id)
);
CREATE TABLE ea_financial_correction_steps (
  correction_id TEXT NOT NULL REFERENCES ea_financial_corrections(id), position INTEGER NOT NULL,
  step_json TEXT NOT NULL CHECK(json_valid(step_json)), attempted_at INTEGER,
  state TEXT NOT NULL DEFAULT 'unattempted' CHECK(state IN ('unattempted','uncertain','applied','no_write','partial','conflict')),
  observed_json TEXT, error TEXT, PRIMARY KEY(correction_id, position)
);
CREATE TABLE ea_financial_correction_guards (
  user_id TEXT NOT NULL, activity_id TEXT NOT NULL, PRIMARY KEY(user_id, activity_id)
);
CREATE UNIQUE INDEX financial_correction_active_activity ON ea_financial_corrections(user_id, activity_id)
  WHERE state IN ('applying','recovering','attention');
CREATE TRIGGER correction_preview_immutable BEFORE UPDATE ON ea_financial_correction_previews
BEGIN SELECT RAISE(ABORT, 'Correction previews are immutable'); END;
CREATE TRIGGER correction_step_frozen BEFORE UPDATE ON ea_financial_correction_steps
WHEN NEW.step_json IS NOT OLD.step_json OR (OLD.attempted_at IS NOT NULL AND NEW.attempted_at IS NOT OLD.attempted_at)
BEGIN SELECT RAISE(ABORT, 'Correction steps and attempts are immutable'); END;
CREATE TRIGGER correction_original_event_admission BEFORE UPDATE ON ea_financial_events
WHEN (NEW.operation_json IS NOT OLD.operation_json OR NEW.outcome_json IS NOT OLD.outcome_json OR NEW.owner_completion_json IS NOT OLD.owner_completion_json)
AND EXISTS(SELECT 1 FROM ea_financial_correction_guards g JOIN ea_financial_activity_occurrences o
  ON o.user_id=g.user_id AND o.activity_id=g.activity_id WHERE o.user_id=NEW.user_id AND o.owner='event' AND o.record_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'Corrected source cannot admit or settle an original operation'); END;
CREATE TRIGGER correction_original_import_admission BEFORE UPDATE ON ea_transaction_import_items
WHEN (NEW.original_attempted_at IS NOT OLD.original_attempted_at OR NEW.actual_result_json IS NOT OLD.actual_result_json
  OR NEW.status IN ('committing','ready','added','updated','already_present'))
AND EXISTS(SELECT 1 FROM ea_financial_correction_guards g JOIN ea_financial_activity_occurrences o
  ON o.user_id=g.user_id AND o.activity_id=g.activity_id WHERE o.user_id=NEW.user_id AND o.owner='import' AND o.record_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'Corrected source cannot admit or settle an original operation'); END;
CREATE VIEW ea_financial_corrected_sources AS
SELECT o.user_id, o.owner, o.record_id, o.activity_id, o.original_imported_id
FROM ea_financial_activity_occurrences o JOIN ea_financial_correction_guards g
ON g.user_id=o.user_id AND g.activity_id=o.activity_id;
CREATE TRIGGER correction_repeat_import AFTER INSERT ON ea_financial_activity_occurrences
WHEN NEW.owner='import' AND EXISTS(SELECT 1 FROM ea_financial_correction_guards WHERE user_id=NEW.user_id AND activity_id=NEW.activity_id)
BEGIN
UPDATE ea_transaction_import_items SET status='needs_review', automatic_safe=0, claim_token=NULL, claimed_at=NULL,
  last_error='This source has an explicit correction; its original write is suppressed.' WHERE user_id=NEW.user_id AND id=NEW.record_id;
END;

DROP TRIGGER financial_event_receipt;
CREATE TRIGGER financial_event_receipt AFTER UPDATE ON ea_financial_events
WHEN json_extract(NEW.outcome_json, '$.outcome') IN ('added', 'updated', 'already_present')
AND NOT EXISTS(SELECT 1 FROM ea_financial_original_receipts WHERE user_id=NEW.user_id AND owner='event' AND record_id=NEW.id)
BEGIN
  INSERT OR IGNORE INTO ea_financial_original_receipts
  (user_id, owner, record_id, revision, captured_at, outcome, input_json, result_json, capture_kind)
  VALUES (NEW.user_id, 'event', NEW.id, NEW.revision, NEW.updated_at,
    json_extract(NEW.outcome_json, '$.outcome'), json_object('operation', json(NEW.operation_json), 'plan', json(NEW.plan_json),
      'sources', COALESCE(json_extract(NEW.operation_json, '$.sourceEvidence'), (SELECT json_group_array(json_object(
        'emailUid', d.email_uid, 'revision', d.revision, 'contentHash', d.content_hash, 'candidate', json(d.candidate_json)))
        FROM ea_financial_documents d WHERE d.user_id = NEW.user_id AND d.event_id = NEW.id))), NEW.outcome_json, 'settlement');
END;

DROP TRIGGER financial_import_receipt;
CREATE TRIGGER financial_import_receipt AFTER UPDATE ON ea_transaction_import_items
WHEN NEW.status IN ('added', 'updated', 'already_present')
AND NOT EXISTS(SELECT 1 FROM ea_financial_original_receipts WHERE user_id=NEW.user_id AND owner='import' AND record_id=NEW.id)
BEGIN
  INSERT OR IGNORE INTO ea_financial_original_receipts
  (user_id, owner, record_id, captured_at, outcome, input_json, result_json, capture_kind)
  VALUES (NEW.user_id, 'import', NEW.id, NEW.updated_at, NEW.status,
    json_object('date', NEW.transaction_date, 'amountCents', NEW.amount_cents, 'payee', NEW.payee,
      'accountId', NEW.actual_account_id, 'categoryId', NEW.actual_category_id, 'importedId', NEW.imported_id,
      'plan', json(NEW.financial_email_plan_json)), NEW.actual_result_json, 'settlement');
END;
CREATE VIEW ea_financial_effective_corrections AS
SELECT c.* FROM ea_financial_corrections c
WHERE c.effective_result_json IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ea_financial_corrections later WHERE later.user_id=c.user_id AND later.activity_id=c.activity_id
  AND later.effective_result_json IS NOT NULL AND later.rowid>c.rowid
);
CREATE TABLE ea_financial_correction_observations (
  id INTEGER PRIMARY KEY, correction_id TEXT NOT NULL, position INTEGER NOT NULL,
  state TEXT NOT NULL, observed_json TEXT NOT NULL, error TEXT, observed_at INTEGER NOT NULL
);
CREATE TRIGGER correction_header_frozen BEFORE UPDATE ON ea_financial_corrections
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.activity_id IS NOT OLD.activity_id OR NEW.budget_id IS NOT OLD.budget_id
 OR NEW.preview_id IS NOT OLD.preview_id OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.predecessor_id IS NOT OLD.predecessor_id
BEGIN SELECT RAISE(ABORT, 'Correction identity is immutable'); END;
CREATE TRIGGER correction_observation_immutable BEFORE UPDATE ON ea_financial_correction_observations
BEGIN SELECT RAISE(ABORT, 'Correction observations are immutable'); END;
CREATE TRIGGER correction_guard_immutable BEFORE UPDATE ON ea_financial_correction_guards
BEGIN SELECT RAISE(ABORT, 'Correction source guards are permanent'); END;
CREATE TRIGGER correction_guard_delete_immutable BEFORE DELETE ON ea_financial_correction_guards
BEGIN SELECT RAISE(ABORT, 'Correction source guards are permanent'); END;
CREATE TRIGGER corrected_source_changed AFTER UPDATE OF revision ON ea_financial_events
WHEN NEW.revision <> OLD.revision AND EXISTS(SELECT 1 FROM ea_financial_corrected_sources WHERE user_id=NEW.user_id AND owner='event' AND record_id=NEW.id)
BEGIN
UPDATE ea_financial_events SET status='needs_review', claim_token=NULL, claimed_at=NULL,
 reason='Source evidence changed after an explicit correction. The corrected entry is preserved.' WHERE id=NEW.id;
END;

CREATE TRIGGER correction_previews_delete_immutable BEFORE DELETE ON ea_financial_correction_previews
BEGIN SELECT RAISE(ABORT, 'Correction journal is immutable'); END;

CREATE TRIGGER correction_steps_delete_immutable BEFORE DELETE ON ea_financial_correction_steps
BEGIN SELECT RAISE(ABORT, 'Correction journal is immutable'); END;

CREATE TRIGGER correction_observations_delete_immutable BEFORE DELETE ON ea_financial_correction_observations
BEGIN SELECT RAISE(ABORT, 'Correction journal is immutable'); END;

CREATE TRIGGER correction_delete_immutable BEFORE DELETE ON ea_financial_corrections
BEGIN SELECT RAISE(ABORT, 'Correction journal is immutable'); END;
