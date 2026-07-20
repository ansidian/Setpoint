ALTER TABLE ea_instance_credentials ADD COLUMN pending_staged_at INTEGER;
ALTER TABLE ea_instance_credentials ADD COLUMN pending_expires_at INTEGER;

UPDATE ea_instance_credentials
SET pending_staged_at = updated_at,
    pending_expires_at = updated_at + 86400000
WHERE pending_value_encrypted IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_instance_credentials_pending_expiry
  ON ea_instance_credentials(pending_expires_at)
  WHERE pending_value_encrypted IS NOT NULL;
