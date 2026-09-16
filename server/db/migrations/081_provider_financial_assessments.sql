-- Schema preparation is inert. Configuration migration explicitly activates the
-- new parser epoch after validation; the original ingestion cutoff is retained.
ALTER TABLE ea_financial_workflow_state ADD COLUMN provider_parser_cutover_at TEXT;
ALTER TABLE ea_financial_documents ADD COLUMN processing_policy TEXT NOT NULL DEFAULT 'legacy'
  CHECK (processing_policy IN ('legacy', 'provider_v1'));
ALTER TABLE ea_financial_documents ADD COLUMN provider_assessment_json TEXT
  CHECK (provider_assessment_json IS NULL OR json_valid(provider_assessment_json));

CREATE TRIGGER financial_document_provider_policy
AFTER INSERT ON ea_financial_documents
WHEN (SELECT provider_parser_cutover_at FROM ea_financial_workflow_state WHERE singleton_id=1) IS NOT NULL
  AND EXISTS (SELECT 1 FROM ea_email_index e, ea_financial_workflow_state w
    WHERE e.user_id=NEW.user_id AND e.uid=NEW.email_uid AND w.singleton_id=1
      AND julianday(e.email_date_utc)>=julianday(w.provider_parser_cutover_at)
      AND julianday(e.indexed_at)>=julianday(w.provider_parser_cutover_at))
BEGIN
  UPDATE ea_financial_documents SET processing_policy='provider_v1' WHERE id=NEW.id;
END;

-- An activation racing an older worker must not admit historical automation.
-- Already-admitted payloads remain immutable and available for recovery.
CREATE TRIGGER financial_provider_epoch_admission
BEFORE UPDATE OF attempted_at ON ea_financial_events
WHEN OLD.attempted_at IS NULL AND NEW.attempted_at IS NOT NULL
  AND NEW.owner_completion_json IS NULL
  AND (SELECT provider_parser_cutover_at FROM ea_financial_workflow_state WHERE singleton_id=1) IS NOT NULL
  AND (NOT EXISTS (SELECT 1 FROM ea_financial_documents d WHERE d.user_id=NEW.user_id AND d.event_id=NEW.id)
    OR EXISTS (SELECT 1 FROM ea_financial_documents d WHERE d.user_id=NEW.user_id AND d.event_id=NEW.id
      AND (d.processing_policy<>'provider_v1' OR COALESCE(json_extract(d.provider_assessment_json,'$.status'),'')<>'parsed')))
BEGIN
  SELECT RAISE(ABORT, 'Historical or unsupported source cannot authorize provider automation');
END;
