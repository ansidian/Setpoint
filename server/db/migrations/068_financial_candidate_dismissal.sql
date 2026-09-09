-- Owner dismissal suppresses work while retaining source and event history.
ALTER TABLE ea_financial_documents ADD COLUMN dismissed_at INTEGER;
ALTER TABLE ea_financial_events ADD COLUMN dismissed_at INTEGER;

CREATE TRIGGER financial_dismissed_event_admission
BEFORE UPDATE OF operation_json, attempted_at, owner_completion_json ON ea_financial_events
WHEN OLD.dismissed_at IS NOT NULL AND (NEW.operation_json IS NOT OLD.operation_json
  OR NEW.attempted_at IS NOT OLD.attempted_at OR NEW.owner_completion_json IS NOT OLD.owner_completion_json)
BEGIN
  SELECT RAISE(ABORT, 'A dismissed financial candidate cannot be submitted');
END;
