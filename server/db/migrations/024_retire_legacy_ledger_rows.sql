-- The 2026-05-05 migrations rebaseline (ce116483) deleted the pre-rebaseline
-- file set, but long-lived DBs (prod) still carry those files' ledger rows.
-- migrate() skips any file whose name is already in the ledger, so a future
-- migration that reuses one of these names would silently never run there —
-- the failure mode behind the 2026-07-01 ea_pinned_emails outage. Rename the
-- dead rows out of the filename namespace ("legacy/" can never match a real
-- .sql file). 001_ea_tables.sql is deliberately absent: it matches a CURRENT
-- file and must stay recorded as executed.
--
-- The list is the exhaustive union of every migration filename ever committed
-- (git log --all --diff-filter=A -- server/db/migrations) minus current files.
--
-- Test bootstraps apply migration files raw, without the runner, so the ledger
-- table may not exist yet.
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

UPDATE migrations SET name = 'legacy/' || name WHERE name IN (
  '002_account_calendar_flag.sql',
  '003_account_icon.sql',
  '004_claude_model.sql',
  '005_briefing_progress.sql',
  '006_email_interests.sql',
  '007_dismissed_emails.sql',
  '008_sessions.sql',
  '009_embeddings.sql',
  '010_account_sort_order.sql',
  '011_important_senders.sql',
  '012_gmail_user_index.sql',
  '013_todoist_settings.sql',
  '014_completed_tasks.sql',
  '015_account_user_index.sql',
  '016_email_search_index.sql',
  '017_drop_gmail_index.sql',
  '018_dedupe_email_fts.sql',
  '019_email_body_text.sql',
  '020_pinned_emails.sql',
  '021_api_tokens.sql',
  '022_pinned_emails_snapshot.sql',
  '023_snoozed_emails.sql',
  '024_snoozed_resurfaced.sql',
  '025_completed_tasks_metadata.sql',
  '026_bill_extract_model.sql',
  '027_notes.sql',
  '028_csrf_browser_bind.sql',
  '029_email_backfill_state.sql',
  '030_triage_snapshots.sql',
  '031_gmail_watch_state.sql',
  '032_email_ai_model.sql',
  '033_email_triage_mode.sql',
  '034_current_data_cache.sql',
  '035_todoist_mirror.sql',
  '036_snapshot_item_source_metadata.sql',
  '037_todoist_webhook_deliveries.sql',
  '038_todoist_oauth_tokens.sql',
  '039_align_email_fts_rowids.sql',
  '040_todoist_health_correctness.sql',
  '041_current_data_health_correctness.sql',
  '042_snapshot_history_labels.sql',
  '043_email_triage_decision_metadata.sql',
  '044_legacy_briefing_cleanup.sql'
);
