ALTER TABLE ea_current_data_cache ADD COLUMN last_refresh_failed_at TEXT;
ALTER TABLE ea_current_data_cache ADD COLUMN last_refresh_error TEXT;
ALTER TABLE ea_current_data_cache ADD COLUMN refresh_failure_count INTEGER NOT NULL DEFAULT 0;
