ALTER TABLE ea_todoist_sync_state ADD COLUMN sync_requested_at TEXT;
ALTER TABLE ea_todoist_sync_state ADD COLUMN sync_request_reason TEXT;
ALTER TABLE ea_todoist_sync_state ADD COLUMN last_check_failed_at TEXT;
ALTER TABLE ea_todoist_sync_state ADD COLUMN failed_check_count INTEGER NOT NULL DEFAULT 0;
