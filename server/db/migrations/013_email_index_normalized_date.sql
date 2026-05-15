ALTER TABLE ea_email_index
  ADD COLUMN email_date_utc TEXT NOT NULL DEFAULT '';

UPDATE ea_email_index
SET email_date_utc = strftime('%Y-%m-%dT%H:%M:%fZ', email_date)
WHERE email_date_utc = ''
  AND datetime(email_date) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_index_user_date_utc
  ON ea_email_index(user_id, email_date_utc DESC);

CREATE INDEX IF NOT EXISTS idx_email_index_user_read_date_utc
  ON ea_email_index(user_id, read, email_date_utc DESC);
