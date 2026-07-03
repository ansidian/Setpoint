-- Audit D2: persist provider thread/message identity so ranking can group
-- same-thread emails. Nullable: values arrive via fetch (Gmail threadId /
-- Message-ID header; iCloud envelope Message-ID) and backfill lazily through
-- sync + reindex — there is nothing to backfill from in SQL.
-- (Filename check: "025_email_thread_identity.sql" never existed; the retired
-- pre-rebaseline 025_completed_tasks_metadata.sql was renamed to legacy/ by 024.)
ALTER TABLE ea_email_index ADD COLUMN thread_id TEXT;
ALTER TABLE ea_email_index ADD COLUMN message_id TEXT;
