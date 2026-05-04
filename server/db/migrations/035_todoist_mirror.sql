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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
