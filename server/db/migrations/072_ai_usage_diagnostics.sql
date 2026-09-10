-- Historical calls have no diagnostic envelope; never infer one from token totals.
ALTER TABLE ea_ai_usage_events ADD COLUMN diagnostics_json TEXT
  CHECK (diagnostics_json IS NULL OR json_valid(diagnostics_json));
CREATE INDEX idx_ai_usage_recent_failures ON ea_ai_usage_events(user_id, run_context, started_at DESC)
  WHERE outcome IN ('provider_error', 'parse_error');
