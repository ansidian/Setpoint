CREATE TABLE IF NOT EXISTS ea_calendar_push_channels (
  channel_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('events', 'calendar_list')),
  calendar_id TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  resource_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'failed', 'retired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_notification_at INTEGER,
  last_message_number TEXT,
  retired_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_calendar_push_channels_owner
  ON ea_calendar_push_channels (user_id, account_id, status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_push_registration_pending
  ON ea_calendar_push_channels (user_id, account_id, kind, calendar_id, callback_url)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS ea_calendar_push_watch_state (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_error TEXT,
  expected_channels INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, account_id)
);

CREATE TABLE IF NOT EXISTS ea_calendar_push_sync (
  user_id TEXT PRIMARY KEY,
  requested_revision INTEGER NOT NULL DEFAULT 0,
  completed_revision INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_error TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
