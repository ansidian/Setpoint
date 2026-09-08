CREATE TABLE ea_financial_correction_keep_previews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  correction_id TEXT NOT NULL REFERENCES ea_financial_corrections(id),
  preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER correction_keep_preview_immutable BEFORE UPDATE ON ea_financial_correction_keep_previews
BEGIN SELECT RAISE(ABORT, 'Keep-result previews are immutable'); END;
