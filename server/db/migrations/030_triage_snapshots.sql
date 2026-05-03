-- Durable email triage, daily snapshot windows, triage jobs, rules, and feedback.

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
