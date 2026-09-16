-- Explicit owner configuration migration; schema installation grants no authority.
CREATE TABLE ea_financial_connection_state (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  migrated_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_fingerprint TEXT NOT NULL
);
CREATE TABLE ea_financial_connections (
  user_id TEXT NOT NULL,
  budget_id TEXT NOT NULL,
  id TEXT NOT NULL,
  provider_id TEXT,
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  position INTEGER NOT NULL,
  PRIMARY KEY(user_id,budget_id,id)
);
