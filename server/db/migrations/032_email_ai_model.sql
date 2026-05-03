ALTER TABLE ea_settings ADD COLUMN email_ai_provider TEXT DEFAULT 'anthropic';
ALTER TABLE ea_settings ADD COLUMN email_ai_model TEXT DEFAULT NULL;
