ALTER TABLE ea_briefing_snapshot_items ADD COLUMN source TEXT;
ALTER TABLE ea_briefing_snapshot_items ADD COLUMN source_at TEXT;
ALTER TABLE ea_briefing_snapshot_items ADD COLUMN resurfaced_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_snapshot_items_source
  ON ea_briefing_snapshot_items(user_id, source, source_at DESC);
