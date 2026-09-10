-- Explicit owner-approved context starts empty. Legacy mappings and Utilities
-- membership do not grant authority to the financial-email profile flow.
ALTER TABLE ea_settings ADD COLUMN financial_profiles_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(financial_profiles_json) AND json_type(financial_profiles_json) = 'array');
ALTER TABLE ea_settings ADD COLUMN financial_profiles_revision INTEGER NOT NULL DEFAULT 0
  CHECK (financial_profiles_revision >= 0);
