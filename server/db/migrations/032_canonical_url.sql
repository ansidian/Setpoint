CREATE TABLE IF NOT EXISTS ea_instance_metadata (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  canonical_origin TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('owner_confirmed', 'legacy_import')),
  confirmed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
