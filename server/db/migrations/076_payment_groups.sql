-- Presentation belongs to Setpoint and is isolated from Actual categories and
-- financial-email profile authority. Reads derive starter groups without writes.
CREATE TABLE IF NOT EXISTS ea_payment_organizations (
  user_id TEXT NOT NULL,
  budget_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  groups_json TEXT NOT NULL CHECK (json_valid(groups_json) AND json_type(groups_json) = 'array'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, budget_id)
);
