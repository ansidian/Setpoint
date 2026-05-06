CREATE INDEX IF NOT EXISTS idx_email_index_user_read_date
  ON ea_email_index(user_id, read, email_date DESC);
