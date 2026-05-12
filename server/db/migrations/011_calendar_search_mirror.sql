CREATE TABLE IF NOT EXISTS ea_calendar_search_mirror_state (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  account_label TEXT,
  account_email TEXT,
  calendar_label TEXT,
  source_color TEXT,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  sync_token TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  last_sync_at TEXT,
  last_success_at TEXT,
  last_full_sync_at TEXT,
  last_incremental_sync_at TEXT,
  last_error TEXT,
  sync_started_at TEXT,
  sync_requested_at TEXT,
  sync_request_reason TEXT,
  dirty_since TEXT,
  dirty_reason TEXT,
  last_check_failed_at TEXT,
  failed_check_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, account_id, calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_search_mirror_state_user_status
  ON ea_calendar_search_mirror_state (user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS ea_calendar_search_occurrences (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  original_start_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT 'Google Calendar',
  account_label TEXT,
  account_email TEXT,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  time_label TEXT,
  duration_label TEXT,
  source_color TEXT,
  event_color TEXT,
  color_id TEXT,
  html_link TEXT,
  open_url TEXT,
  recurring_event_id TEXT,
  recurring_kind TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  searchable_text TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, account_id, calendar_id, event_id, original_start_key)
);

CREATE INDEX IF NOT EXISTS idx_calendar_search_occurrences_range
  ON ea_calendar_search_occurrences (user_id, start_ms, status);

CREATE INDEX IF NOT EXISTS idx_calendar_search_occurrences_calendar
  ON ea_calendar_search_occurrences (user_id, account_id, calendar_id, status, start_ms);
