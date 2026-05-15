CREATE TABLE IF NOT EXISTS ea_completed_tasks_next (
  user_id TEXT NOT NULL,
  todoist_id TEXT NOT NULL,
  completed_at TEXT DEFAULT (datetime('now')),
  due_date TEXT NOT NULL,
  snapshot_json TEXT,
  PRIMARY KEY (user_id, todoist_id, due_date)
);

INSERT OR REPLACE INTO ea_completed_tasks_next
  (user_id, todoist_id, completed_at, due_date, snapshot_json)
SELECT user_id, todoist_id, completed_at, due_date, snapshot_json
FROM ea_completed_tasks
WHERE due_date IS NOT NULL;

DROP TABLE ea_completed_tasks;

ALTER TABLE ea_completed_tasks_next RENAME TO ea_completed_tasks;
