-- Category-only differences no longer block a verified transaction. Recheck
-- these historical results once through the worker's immutable recovery path;
-- do not infer success here or authorize another Actual import.
UPDATE ea_financial_events
SET status = 'pending', next_attempt_at = NULL, updated_at = unixepoch('now') * 1000
WHERE status = 'needs_review'
  AND dismissed_at IS NULL
  AND attempted_at IS NOT NULL
  AND json_extract(operation_json, '$.executor') = 'financial'
  AND json_extract(operation_json, '$.input.kind') = 'transaction'
  AND json_extract(outcome_json, '$.outcome') = 'needs_review'
  AND json_type(outcome_json, '$.transactionId') = 'text'
  AND length(trim(json_extract(outcome_json, '$.transactionId'))) > 0
  AND reason = 'Recorded in Actual, but the category differs from the selected category. Review the category in Actual.'
  AND reason = json_extract(outcome_json, '$.reason')
  AND NOT EXISTS (
    SELECT 1 FROM ea_financial_corrected_sources c
    WHERE c.user_id = ea_financial_events.user_id AND c.owner = 'event' AND c.record_id = ea_financial_events.id
  );
