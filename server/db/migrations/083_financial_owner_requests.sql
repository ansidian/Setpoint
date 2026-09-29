-- Owner-requested review of an email the automatic workflow ignored or settled.
-- Parser-policy refreshes and schedule coverage must not undo the request.
ALTER TABLE ea_financial_documents ADD COLUMN owner_requested_at INTEGER;
