-- Acknowledgment accepts an unresolved historical failure; it does not claim
-- ingestion completed. Retain the original job, error, payload and attempts.
ALTER TABLE ea_triage_jobs ADD COLUMN acknowledged_at TEXT;
ALTER TABLE ea_triage_jobs ADD COLUMN acknowledgment_reason TEXT;
