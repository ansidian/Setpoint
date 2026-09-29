-- The legacy AI financial assessment path is retired. Unfinished legacy documents
-- without an event can no longer progress, so they settle as owner-dismissed history.
-- Provider documents, associated documents and owner-requested sources are untouched.
UPDATE ea_financial_documents
SET status = 'ignored',
    dismissed_at = COALESCE(dismissed_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    last_error = 'Retired with the legacy financial assessment path.',
    next_attempt_at = NULL,
    revision = revision + 1,
    processed_revision = revision + 1,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE processing_policy = 'legacy'
  AND status IN ('pending', 'retry')
  AND event_id IS NULL
  AND owner_requested_at IS NULL;
