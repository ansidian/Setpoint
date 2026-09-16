import type { Client } from '@libsql/client';
import db from '../db/connection.ts';
import { FINANCIAL_PROVIDER_PARSER_POLICY } from '../financial-parsers/index.ts';

export const PROVIDER_EPOCH_INACTIVE = `(SELECT provider_parser_cutover_at FROM ea_financial_workflow_state WHERE singleton_id=1) IS NULL`;
/** Historical automatic work stays dormant; admitted operations retain recovery authority. */
export const PROVIDER_EVENT_ELIGIBLE = `(${PROVIDER_EPOCH_INACTIVE} OR attempted_at IS NOT NULL OR owner_completion_json IS NOT NULL OR (
  EXISTS (SELECT 1 FROM ea_financial_documents d WHERE d.user_id=ea_financial_events.user_id AND d.event_id=ea_financial_events.id)
  AND NOT EXISTS (SELECT 1 FROM ea_financial_documents d WHERE d.user_id=ea_financial_events.user_id AND d.event_id=ea_financial_events.id AND d.processing_policy<>'provider_v1')))`;
export const PROVIDER_DOCUMENT_ELIGIBLE = `(${PROVIDER_EPOCH_INACTIVE} OR next.processing_policy='provider_v1' OR EXISTS (
  SELECT 1 FROM ea_financial_events e WHERE e.user_id=next.user_id AND e.id=next.event_id AND (e.attempted_at IS NOT NULL OR e.owner_completion_json IS NOT NULL)))`;
export const PROVIDER_ADMISSION_ELIGIBLE = `(${PROVIDER_EPOCH_INACTIVE} OR owner_completion_json IS NOT NULL OR (
  EXISTS (SELECT 1 FROM ea_financial_documents d WHERE d.user_id=ea_financial_events.user_id AND d.event_id=ea_financial_events.id)
  AND NOT EXISTS (SELECT 1 FROM ea_financial_documents d WHERE d.user_id=ea_financial_events.user_id AND d.event_id=ea_financial_events.id
    AND (d.processing_policy<>'provider_v1' OR COALESCE(json_extract(d.provider_assessment_json,'$.status'),'')<>'parsed'))))`;
export const LEGACY_IMPORT_ELIGIBLE = `(${PROVIDER_EPOCH_INACTIVE} OR original_attempted_at IS NOT NULL
  OR json_extract(financial_email_plan_json,'$.transferExecution.attemptedAt') IS NOT NULL OR confirmed_at IS NOT NULL)`;
export const FINANCIAL_PROFILE_REVISION = `COALESCE((SELECT revision FROM ea_financial_connection_state WHERE user_id=settings.user_id), settings.financial_profiles_revision)`;

/** Explicit post-verification switch. No source is enrolled or financial fact rewritten. */
export async function activateFinancialProviderEpoch(userId: string, revision: number, dbClient: Pick<Client, 'execute' | 'batch'> = db): Promise<string> {
  const result = await dbClient.execute({sql: `UPDATE ea_financial_workflow_state SET provider_parser_cutover_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE singleton_id=1 AND provider_parser_cutover_at IS NULL
      AND EXISTS (SELECT 1 FROM ea_financial_connection_state WHERE user_id=? AND revision=?)
      AND NOT EXISTS (SELECT 1 FROM ea_financial_events WHERE attempted_at IS NULL AND owner_completion_json IS NOT NULL AND status<>'settled' AND dismissed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM ea_transaction_import_items WHERE confirmed_at IS NOT NULL AND original_attempted_at IS NULL
        AND json_extract(financial_email_plan_json,'$.transferExecution.attemptedAt') IS NULL AND status IN ('queued','ready','reconciling','importing'))
      AND NOT EXISTS (SELECT 1 FROM ea_financial_events WHERE status='processing')
      AND NOT EXISTS (SELECT 1 FROM ea_financial_documents WHERE status='processing')
      AND NOT EXISTS (SELECT 1 FROM ea_transaction_import_items WHERE status IN ('reconciling','importing'))
    RETURNING provider_parser_cutover_at`, args: [userId, revision]});
  if (!result.rows[0]) throw new Error('Activation requires the current migrated configuration, idle workers, and no pending owner-confirmed work. An existing epoch cannot be reset.');
  return String(result.rows[0].provider_parser_cutover_at);
}

/** Reassess unsubmitted post-epoch sources once after a parser-policy release.
 * Settled events, explicit dismissals, confirmations and admitted payloads never reopen. */
export async function refreshFinancialProviderAssessments(dbClient: Pick<Client, 'execute'>): Promise<void> {
  await dbClient.execute({sql: `UPDATE ea_financial_documents SET status='pending', revision=revision+1,
    next_attempt_at=NULL, last_error=NULL, claim_token=NULL, claimed_at=NULL,
    provider_assessment_json=NULL, updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
    WHERE processing_policy='provider_v1' AND dismissed_at IS NULL AND status IN ('retry','ignored','associated')
      AND provider_assessment_json IS NOT NULL AND json_extract(provider_assessment_json,'$.policyVersion') IS NOT ?
      AND (event_id IS NULL OR EXISTS (SELECT 1 FROM ea_financial_events e WHERE e.user_id=ea_financial_documents.user_id
        AND e.id=ea_financial_documents.event_id AND e.attempted_at IS NULL AND e.owner_completion_json IS NULL
        AND e.dismissed_at IS NULL AND e.status IN ('pending','waiting','needs_review')))
      AND NOT EXISTS (SELECT 1 FROM ea_financial_corrected_sources g WHERE g.user_id=ea_financial_documents.user_id
        AND g.owner='event' AND g.record_id=ea_financial_documents.event_id)`, args:[FINANCIAL_PROVIDER_PARSER_POLICY]});
}
