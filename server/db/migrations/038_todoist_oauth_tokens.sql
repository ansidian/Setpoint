ALTER TABLE ea_settings ADD COLUMN todoist_oauth_refresh_token_encrypted TEXT;
ALTER TABLE ea_settings ADD COLUMN todoist_oauth_access_token_expires_at TEXT;
ALTER TABLE ea_settings ADD COLUMN todoist_oauth_scope TEXT;
ALTER TABLE ea_settings ADD COLUMN todoist_oauth_token_type TEXT;
