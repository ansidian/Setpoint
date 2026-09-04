ALTER TABLE ea_owner
  ADD COLUMN password_login_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ea_owner
  ADD COLUMN password_login_reset_at INTEGER NOT NULL DEFAULT 0;
