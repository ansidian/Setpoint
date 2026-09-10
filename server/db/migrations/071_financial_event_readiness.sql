-- Exact, self-contained sources need no speculative account-wide collection.
-- This affects readiness only; source/profile revisions and immutable write
-- admission still decide whether an operation may be sent to Actual.
ALTER TABLE ea_financial_events ADD COLUMN collection_required INTEGER NOT NULL DEFAULT 1
  CHECK (collection_required IN (0, 1));
