ALTER TABLE ea_csrf_tokens ADD COLUMN browser_bind_hash TEXT;
ALTER TABLE ea_csrf_tokens ADD COLUMN oauth_user_id TEXT;
ALTER TABLE ea_csrf_tokens ADD COLUMN oauth_label TEXT;
