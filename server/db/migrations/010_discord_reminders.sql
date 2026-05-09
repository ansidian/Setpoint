ALTER TABLE ea_settings
  ADD COLUMN discord_webhook_url_encrypted TEXT DEFAULT NULL;

ALTER TABLE ea_settings
  ADD COLUMN discord_user_id TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS ea_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('calendar_event', 'todoist_task')),
  source_account_id TEXT,
  source_calendar_id TEXT,
  source_item_id TEXT NOT NULL,
  source_occurrence_id TEXT,
  anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('event_start', 'todoist_due_datetime', 'todoist_date_9am_pacific')),
  anchor_at TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL,
  remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'missed')),
  sent_at TEXT,
  missed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  retry_after TEXT,
  last_error TEXT,
  payload_snapshot_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ea_reminders_due
  ON ea_reminders(status, remind_at, retry_after);

CREATE INDEX IF NOT EXISTS idx_ea_reminders_user_source
  ON ea_reminders(user_id, source_type, source_item_id, source_occurrence_id);
