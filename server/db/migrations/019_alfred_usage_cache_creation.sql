-- Record cache-WRITE tokens, not just reads. recordAlfredUsage already stored
-- input_tokens (fresh) + cached_input_tokens (cache_read), but dropped
-- cache_creation_input_tokens on the floor. On a multi-call Alfred run the
-- write line is the single priciest per-token component (1.25x base vs 0.1x for
-- reads), so omitting it makes the usage table understate true cost. Additive,
-- default 0 -- existing rows read as "no recorded writes", which is accurate
-- (we never captured the value for them).
ALTER TABLE ea_alfred_usage
  ADD COLUMN cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0;
