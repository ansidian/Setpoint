-- Remove retired legacy briefing storage after the runtime no longer reads or
-- writes these tables. Current snapshot, triage, cache, and Todoist tombstone
-- tables remain active.

BEGIN TRANSACTION;

UPDATE ea_settings
SET email_ai_provider = CASE
  WHEN (email_ai_model IS NULL OR trim(email_ai_model) = '') AND claude_model LIKE 'gpt-%' THEN 'openai'
  WHEN (email_ai_model IS NULL OR trim(email_ai_model) = '') AND claude_model LIKE 'claude-%' THEN 'anthropic'
  WHEN email_ai_provider IS NULL OR trim(email_ai_provider) = '' THEN
    CASE
      WHEN email_ai_model LIKE 'gpt-%' THEN 'openai'
      ELSE 'anthropic'
    END
  ELSE email_ai_provider
END;

UPDATE ea_settings
SET email_ai_model = CASE
  WHEN (email_ai_model IS NULL OR trim(email_ai_model) = '')
    AND (claude_model LIKE 'gpt-%' OR claude_model LIKE 'claude-%')
    THEN claude_model
  WHEN email_ai_model IS NULL OR trim(email_ai_model) = '' THEN
    CASE
      WHEN email_ai_provider = 'openai' THEN 'gpt-5.5'
      ELSE 'claude-sonnet-4-6'
    END
  ELSE email_ai_model
END;

ALTER TABLE ea_settings DROP COLUMN claude_model;

DROP TABLE IF EXISTS ea_embeddings;
DROP TABLE IF EXISTS ea_pinned_emails;
DROP INDEX IF EXISTS idx_ea_briefings_user_status;
DROP TABLE IF EXISTS ea_briefings;

DELETE FROM ea_completed_tasks WHERE due_date IS NULL;

COMMIT;
