ALTER TABLE ea_email_index ADD COLUMN verification_code TEXT;
ALTER TABLE ea_email_index ADD COLUMN verification_code_kind TEXT;
ALTER TABLE ea_email_index ADD COLUMN verification_code_detected_at TEXT;
ALTER TABLE ea_email_index ADD COLUMN verification_code_active_until TEXT;
ALTER TABLE ea_email_index ADD COLUMN verification_code_detector_version INTEGER;
