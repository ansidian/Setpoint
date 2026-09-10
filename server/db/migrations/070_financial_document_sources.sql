-- Financial acquisition retains complete provider/PDF evidence separately from
-- the searchable message body. Ordinary index refreshes cannot drop attachments.
ALTER TABLE ea_financial_documents ADD COLUMN acquired_source_json TEXT
  CHECK (acquired_source_json IS NULL OR json_valid(acquired_source_json));
ALTER TABLE ea_financial_documents ADD COLUMN acquired_source_key TEXT;
ALTER TABLE ea_financial_documents ADD COLUMN source_attempt_key TEXT;
ALTER TABLE ea_financial_documents ADD COLUMN source_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (source_attempts >= 0 AND source_attempts <= 3);
