CREATE TABLE IF NOT EXISTS ea_todoist_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_name TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_todoist_webhook_deliveries_received_at
  ON ea_todoist_webhook_deliveries (received_at);
