-- Prod still carries the legacy April-2026 briefing-era ea_pinned_emails
-- (old 020_pinned_emails.sql + 022_pinned_emails_snapshot.sql: no account_id,
-- nullable pinned_at). Its DROP in 044_legacy_briefing_cleanup.sql was pruned
-- from the tree the same day it was written and never deployed, so 022's
-- CREATE TABLE IF NOT EXISTS silently no-opped against the old shape. Rebuild
-- to the canonical shape; briefing-era pin rows are retired data and are
-- deliberately discarded (finishing what 044 intended).
DROP TABLE IF EXISTS ea_pinned_emails;

CREATE TABLE ea_pinned_emails (
  user_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  account_id TEXT,
  pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
  email_snapshot TEXT,
  PRIMARY KEY (user_id, email_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_emails_user
  ON ea_pinned_emails (user_id, pinned_at);
