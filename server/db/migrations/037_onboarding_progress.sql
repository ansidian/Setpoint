CREATE TABLE IF NOT EXISTS ea_onboarding_progress (
  user_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  step_states TEXT NOT NULL DEFAULT '{}',
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES ea_owner(user_id) ON DELETE CASCADE
);

-- Owners already present when this migration lands are existing installations.
-- Keep their dashboard behavior unchanged and let them reopen setup manually.
INSERT OR IGNORE INTO ea_onboarding_progress
  (user_id, version, step_states, completed_at, updated_at)
SELECT user_id, 1, '{}',
       CAST(strftime('%s', 'now') AS INTEGER) * 1000,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM ea_owner;
