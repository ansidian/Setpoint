UPDATE ea_triage_jobs
SET scheduled_for = NULL,
    last_error = 'Legacy weak-security grace removed; classify immediately',
    updated_at = datetime('now')
WHERE job_type = 'email_triage'
  AND status = 'queued'
  AND EXISTS (
    SELECT 1
    FROM ea_email_triage t
    WHERE t.user_id = ea_triage_jobs.user_id
      AND t.account_id = ea_triage_jobs.account_id
      AND t.email_id = ea_triage_jobs.email_id
      AND t.triage_status = 'pending'
      AND t.triage_source = 'weak_security_grace'
  );
