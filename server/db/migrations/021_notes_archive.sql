-- Promote Notes to a full tab: archive lifecycle + recency axis.
-- archived_at: NULL = active; ISO timestamp = archived (promoted or manually archived).
-- updated_at: last content/archive mutation, distinct from the reorder-churned sort_order.
ALTER TABLE ea_notes ADD COLUMN archived_at TEXT;
ALTER TABLE ea_notes ADD COLUMN updated_at TEXT;
