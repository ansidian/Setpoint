CREATE TRIGGER financial_provider_legacy_import_admission
BEFORE UPDATE OF original_attempted_at, financial_email_plan_json ON ea_transaction_import_items
WHEN (SELECT provider_parser_cutover_at FROM ea_financial_workflow_state WHERE singleton_id=1) IS NOT NULL
  AND NEW.confirmed_at IS NULL AND OLD.original_attempted_at IS NULL
  AND json_extract(OLD.financial_email_plan_json,'$.transferExecution.attemptedAt') IS NULL
  AND (NEW.original_attempted_at IS NOT NULL OR json_extract(NEW.financial_email_plan_json,'$.transferExecution.attemptedAt') IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Historical import cannot authorize provider automation');
END;
