-- A ledger of provider attempts, not email decisions or persisted-plan winners.
CREATE TABLE ea_ai_usage_cutover (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL
);
INSERT INTO ea_ai_usage_cutover VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE ea_ai_usage_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_context TEXT NOT NULL CHECK (run_context IN ('production', 'evaluation')),
  origin TEXT NOT NULL,
  account_id TEXT,
  email_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('triage_cheap', 'triage_strong', 'extraction', 'verification', 'matching')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  provider_latency_ms REAL NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('response_received', 'succeeded', 'provider_error', 'parse_error')),
  http_status INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_creation_5m_tokens INTEGER,
  cache_creation_1h_tokens INTEGER,
  estimated_cost_usd REAL,
  pricing_version TEXT
);
CREATE INDEX ea_ai_usage_owner_window ON ea_ai_usage_events(user_id, started_at, run_context);

-- Freeze only the old analytics' usage projection, never decisions, prompts,
-- email bodies or candidate fields. Mutable rows cannot later double count a
-- new call or erase this already-incomplete legacy latest-row snapshot.
CREATE TABLE ea_ai_usage_legacy_triage (
  user_id TEXT NOT NULL,
  last_triaged_at TEXT,
  tier TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER
);
INSERT INTO ea_ai_usage_legacy_triage
WITH tiers AS (
  SELECT user_id, last_triaged_at, 'cheap' AS tier,
    CASE WHEN json_valid(cheap_model_result_json) THEN cheap_model_result_json ELSE '{}' END AS result,
    CASE WHEN json_valid(model_usage_json) THEN model_usage_json ELSE '{}' END AS all_usage
  FROM ea_email_triage
  WHERE model_usage_json IS NOT NULL AND model_usage_json != '{}'
  UNION ALL
  SELECT user_id, last_triaged_at, 'strong',
    CASE WHEN json_valid(strong_model_result_json) THEN strong_model_result_json ELSE '{}' END,
    CASE WHEN json_valid(model_usage_json) THEN model_usage_json ELSE '{}' END
  FROM ea_email_triage
  WHERE model_usage_json IS NOT NULL AND model_usage_json != '{}'
), calls AS (
  SELECT *, CASE WHEN json_type(all_usage, '$.' || tier) = 'object'
    THEN json_extract(all_usage, '$.' || tier)
    ELSE CASE WHEN json_type(result, '$.usage') = 'object'
      THEN json_extract(result, '$.usage') ELSE '{}' END END AS usage
  FROM tiers
)
SELECT user_id, last_triaged_at, tier,
  json_extract(result, '$.provider'), json_extract(result, '$.model'),
  json_extract(usage, '$.input_tokens'), json_extract(usage, '$.output_tokens'),
  COALESCE(json_extract(usage, '$.prompt_tokens_details.cached_tokens'),
           json_extract(usage, '$.input_tokens_details.cached_tokens'))
FROM calls WHERE json_extract(result, '$.provider') = 'openai';
CREATE INDEX ea_ai_usage_legacy_owner_window ON ea_ai_usage_legacy_triage(user_id, last_triaged_at);
