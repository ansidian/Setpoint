CREATE TABLE IF NOT EXISTS ea_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  email TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#818cf8',
  credentials_encrypted TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  calendar_enabled INTEGER DEFAULT 0,
  icon TEXT DEFAULT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ea_accounts_user
  ON ea_accounts(user_id);

CREATE TABLE IF NOT EXISTS ea_settings (
  user_id TEXT PRIMARY KEY,
  schedules_json TEXT DEFAULT '[{"time":"08:00","tz":"America/Los_Angeles","enabled":true,"label":"Morning"},{"time":"20:00","tz":"America/Los_Angeles","enabled":true,"label":"Evening"}]',
  email_lookback_hours INTEGER DEFAULT 16,
  weather_lat REAL DEFAULT 34.0686,
  weather_lng REAL DEFAULT -118.0276,
  weather_location TEXT DEFAULT 'El Monte, CA',
  actual_budget_url TEXT,
  actual_budget_password_encrypted TEXT,
  actual_budget_sync_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  email_interests_json TEXT DEFAULT NULL,
  important_senders_json TEXT DEFAULT '[]',
  todoist_api_token_encrypted TEXT,
  bill_extract_provider TEXT DEFAULT 'anthropic',
  bill_extract_model TEXT DEFAULT 'claude-haiku-4-5',
  email_ai_provider TEXT DEFAULT 'anthropic',
  email_ai_model TEXT DEFAULT NULL,
  email_triage_mode TEXT DEFAULT 'auto',
  todoist_oauth_refresh_token_encrypted TEXT,
  todoist_oauth_access_token_expires_at TEXT,
  todoist_oauth_scope TEXT,
  todoist_oauth_token_type TEXT
);

CREATE TABLE IF NOT EXISTS ea_sessions (
  token TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ea_sessions_expires
  ON ea_sessions(expires_at);

CREATE TABLE IF NOT EXISTS ea_csrf_tokens (
  token TEXT PRIMARY KEY,
  account_label TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL,
  browser_bind_hash TEXT,
  oauth_user_id TEXT,
  oauth_label TEXT
);

CREATE TABLE IF NOT EXISTS ea_dismissed_emails (
  user_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  dismissed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, email_id)
);

CREATE TABLE IF NOT EXISTS ea_completed_tasks (
  user_id TEXT NOT NULL,
  todoist_id TEXT NOT NULL,
  completed_at TEXT DEFAULT (datetime('now')),
  due_date TEXT NOT NULL,
  snapshot_json TEXT,
  PRIMARY KEY (user_id, todoist_id, due_date)
);

CREATE TABLE IF NOT EXISTS ea_email_index (
  uid TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_label TEXT NOT NULL,
  account_email TEXT NOT NULL,
  account_color TEXT DEFAULT '#818cf8',
  account_icon TEXT DEFAULT '📧',
  from_name TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  email_date TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_index_user
  ON ea_email_index(user_id, email_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_index_account
  ON ea_email_index(account_id);

CREATE VIRTUAL TABLE IF NOT EXISTS ea_email_fts USING fts5(
  uid UNINDEXED,
  from_name,
  from_address,
  subject,
  body_snippet,
  body_text
);

CREATE TABLE IF NOT EXISTS ea_api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ea_api_tokens_hash
  ON ea_api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS ea_snoozed_emails (
  user_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  until_ts INTEGER NOT NULL,
  snoozed_at TEXT DEFAULT (datetime('now')),
  email_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'snoozed',
  resurfaced_at INTEGER,
  PRIMARY KEY (user_id, email_id)
);

CREATE INDEX IF NOT EXISTS idx_snoozed_emails_user_until
  ON ea_snoozed_emails (user_id, until_ts);

CREATE INDEX IF NOT EXISTS idx_snoozed_emails_user_status
  ON ea_snoozed_emails (user_id, status);

CREATE TABLE IF NOT EXISTS ea_email_backfill_state (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  mailbox_scope TEXT NOT NULL DEFAULT 'inbox',
  status TEXT NOT NULL DEFAULT 'idle',
  target_days INTEGER,
  oldest_target_date TEXT,
  oldest_indexed_date TEXT,
  last_scanned_at TEXT,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  indexed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, account_id, mailbox_scope)
);

CREATE INDEX IF NOT EXISTS idx_email_backfill_state_user
  ON ea_email_backfill_state(user_id, mailbox_scope, status);

CREATE TABLE IF NOT EXISTS ea_email_triage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  thread_id TEXT,
  lane TEXT NOT NULL DEFAULT 'needs_attention',
  category TEXT NOT NULL DEFAULT 'uncategorized',
  urgency TEXT NOT NULL DEFAULT 'normal',
  escalation_badge TEXT,
  summary TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  deadline_at TEXT,
  confidence REAL,
  triage_status TEXT NOT NULL DEFAULT 'pending',
  triage_source TEXT NOT NULL DEFAULT 'unknown',
  rule_id INTEGER,
  cheap_model_result_json TEXT,
  strong_model_result_json TEXT,
  model_usage_json TEXT NOT NULL DEFAULT '{}',
  estimated_cost_usd REAL,
  latency_ms INTEGER,
  bill_candidate_json TEXT,
  handled_at TEXT,
  dismissed_at TEXT,
  provider_state TEXT NOT NULL DEFAULT 'available',
  last_triaged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  decision_metadata_json TEXT,
  UNIQUE(user_id, account_id, email_id)
);

CREATE INDEX IF NOT EXISTS idx_email_triage_user_lane
  ON ea_email_triage(user_id, lane, triage_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_triage_account_thread
  ON ea_email_triage(user_id, account_id, thread_id);

CREATE TABLE IF NOT EXISTS ea_briefing_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  status TEXT NOT NULL DEFAULT 'active',
  schedule_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  frozen_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, start_at, end_at)
);

CREATE INDEX IF NOT EXISTS idx_briefing_snapshots_user_status
  ON ea_briefing_snapshots(user_id, status, start_at DESC);

CREATE TABLE IF NOT EXISTS ea_briefing_snapshot_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  triage_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  lane_at_snapshot TEXT NOT NULL,
  summary_at_snapshot TEXT NOT NULL DEFAULT '',
  action_at_snapshot TEXT NOT NULL DEFAULT '',
  urgency_at_snapshot TEXT NOT NULL DEFAULT 'normal',
  deadline_at_snapshot TEXT,
  category_at_snapshot TEXT NOT NULL DEFAULT 'uncategorized',
  escalation_badge_at_snapshot TEXT,
  subject_at_snapshot TEXT NOT NULL DEFAULT '',
  from_name_at_snapshot TEXT NOT NULL DEFAULT '',
  from_address_at_snapshot TEXT NOT NULL DEFAULT '',
  email_date_at_snapshot TEXT,
  account_label_at_snapshot TEXT NOT NULL DEFAULT '',
  account_email_at_snapshot TEXT NOT NULL DEFAULT '',
  account_color_at_snapshot TEXT NOT NULL DEFAULT '#818cf8',
  account_icon_at_snapshot TEXT NOT NULL DEFAULT 'Mail',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_carryover INTEGER NOT NULL DEFAULT 0,
  dismissed_from_today_at TEXT,
  handled_at TEXT,
  provider_removed_at TEXT,
  source TEXT,
  source_at TEXT,
  resurfaced_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(snapshot_id) REFERENCES ea_briefing_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY(triage_id) REFERENCES ea_email_triage(id) ON DELETE CASCADE,
  UNIQUE(snapshot_id, triage_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_snapshot_lane
  ON ea_briefing_snapshot_items(snapshot_id, lane_at_snapshot, sort_order);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_user_email
  ON ea_briefing_snapshot_items(user_id, account_id, email_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_source
  ON ea_briefing_snapshot_items(user_id, source, source_at DESC);

CREATE TABLE IF NOT EXISTS ea_triage_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  locked_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  scheduled_for TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_triage_jobs_status
  ON ea_triage_jobs(status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_triage_jobs_message
  ON ea_triage_jobs(user_id, account_id, email_id, job_type);

CREATE TABLE IF NOT EXISTS ea_triage_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  rule_type TEXT NOT NULL,
  match_json TEXT NOT NULL DEFAULT '{}',
  lane TEXT,
  category TEXT,
  urgency TEXT,
  escalation_badge TEXT,
  route_to_model TEXT,
  confidence REAL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_triage_rules_user_enabled
  ON ea_triage_rules(user_id, enabled, priority);

CREATE TABLE IF NOT EXISTS ea_triage_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  triage_id INTEGER,
  snapshot_item_id INTEGER,
  account_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(triage_id) REFERENCES ea_email_triage(id) ON DELETE SET NULL,
  FOREIGN KEY(snapshot_item_id) REFERENCES ea_briefing_snapshot_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_triage_feedback_message
  ON ea_triage_feedback(user_id, account_id, email_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ea_bills_mirror_state (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'needs_sync',
  actual_configured INTEGER NOT NULL DEFAULT 0,
  actual_budget_url TEXT,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  pending_refresh_at TEXT,
  refresh_started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ea_bill_schedule_mirror (
  user_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'bill',
  next_date TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, schedule_id)
);

CREATE INDEX IF NOT EXISTS idx_bill_schedule_mirror_user_next_date
  ON ea_bill_schedule_mirror(user_id, next_date);

CREATE TABLE IF NOT EXISTS ea_bill_occurrence_mirror (
  user_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'bill',
  paid INTEGER NOT NULL DEFAULT 0,
  open_action_disabled INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, occurrence_id)
);

CREATE INDEX IF NOT EXISTS idx_bill_occurrence_mirror_user_date
  ON ea_bill_occurrence_mirror(user_id, occurrence_date);

CREATE INDEX IF NOT EXISTS idx_bill_occurrence_mirror_schedule
  ON ea_bill_occurrence_mirror(user_id, schedule_id);

CREATE TABLE IF NOT EXISTS ea_gmail_watch_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email_address TEXT NOT NULL,
  last_history_id TEXT,
  watch_expiration_at TEXT,
  watch_status TEXT NOT NULL DEFAULT 'inactive',
  last_notification_at TEXT,
  last_renewed_at TEXT,
  last_sync_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_watch_state_expiration
  ON ea_gmail_watch_state(watch_status, watch_expiration_at);

CREATE INDEX IF NOT EXISTS idx_gmail_watch_state_email
  ON ea_gmail_watch_state(lower(email_address));

CREATE TABLE IF NOT EXISTS ea_current_data_cache (
  user_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  payload_json TEXT,
  fetched_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'current',
  error_message TEXT,
  refresh_started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_refresh_failed_at TEXT,
  last_refresh_error TEXT,
  refresh_failure_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_current_data_cache_user_status
  ON ea_current_data_cache (user_id, status);

CREATE TABLE IF NOT EXISTS ea_todoist_sync_state (
  user_id TEXT PRIMARY KEY,
  sync_token TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  last_sync_at TEXT,
  last_success_at TEXT,
  last_full_sync_at TEXT,
  last_incremental_sync_at TEXT,
  last_error TEXT,
  sync_started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sync_requested_at TEXT,
  sync_request_reason TEXT,
  last_check_failed_at TEXT,
  failed_check_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ea_todoist_items (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  project_id TEXT,
  section_id TEXT,
  parent_id TEXT,
  content TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  due_datetime TEXT,
  due_timezone TEXT,
  due_is_recurring INTEGER NOT NULL DEFAULT 0,
  priority INTEGER,
  labels_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_todoist_items_active_due
  ON ea_todoist_items (user_id, is_deleted, checked, due_date);

CREATE INDEX IF NOT EXISTS idx_todoist_items_project
  ON ea_todoist_items (user_id, project_id);

CREATE TABLE IF NOT EXISTS ea_todoist_projects (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  color TEXT,
  is_inbox_project INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_todoist_projects_active
  ON ea_todoist_projects (user_id, is_deleted);

CREATE TABLE IF NOT EXISTS ea_todoist_labels (
  user_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  color TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_todoist_labels_active
  ON ea_todoist_labels (user_id, is_deleted);

CREATE TABLE IF NOT EXISTS ea_todoist_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_name TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_todoist_webhook_deliveries_received_at
  ON ea_todoist_webhook_deliveries (received_at);
