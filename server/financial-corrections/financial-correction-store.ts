import { createHash } from 'node:crypto';
import type { Client, Transaction, Row } from '@libsql/client';
import type { FinancialCorrection, FinancialCorrectionPreview, FinancialCorrectionKeepPreview, CorrectionStepStatus } from '../../shared/types/financial-corrections.ts';
import db from '../db/connection.ts';
import { correctionJson } from '../actual/actual.ts';
import { correctionConstraint } from './financial-correction-model.ts';

type Reader = Pick<Client, 'execute'> | Transaction;
export function createFinancialCorrectionStore(client: Client = db) {
  async function sourceRevision(userId: string, activityId: string, reader: Reader = client): Promise<string> {
    const occurrences = (await reader.execute({ sql: 'SELECT * FROM ea_financial_activity_occurrences WHERE user_id=? AND activity_id=? ORDER BY owner, record_id', args: [userId, activityId] })).rows;
    const sources: unknown[] = [(await reader.execute({ sql: 'SELECT actual_budget_sync_id FROM ea_settings WHERE user_id=?', args: [userId] })).rows];
    const conflicts = (await reader.execute({ sql: `SELECT 1 FROM ea_financial_identity_conflicts c JOIN ea_financial_activity_occurrences o ON o.user_id=c.user_id AND o.record_id=c.record_id AND o.owner='import' WHERE o.user_id=? AND o.activity_id=?`, args: [userId, activityId] })).rows;
    if (conflicts.length) correctionConstraint('The original source aliases are quarantined and require exact identity resolution.');
    for (const occurrence of occurrences) {
      if (occurrence.owner === 'event') {
        const event = (await reader.execute({ sql: 'SELECT revision, owner_completion_json, operation_json, outcome_json FROM ea_financial_events WHERE user_id=? AND id=?', args: [userId, String(occurrence.record_id)] })).rows;
        const documents = (await reader.execute({ sql: 'SELECT d.id, d.revision, d.content_hash, d.candidate_json, e.sender_authentication_json FROM ea_financial_documents d LEFT JOIN ea_email_index e ON e.user_id=d.user_id AND e.uid=d.email_uid WHERE d.user_id=? AND d.event_id=? ORDER BY d.id', args: [userId, String(occurrence.record_id)] })).rows;
        sources.push({ occurrence, event, documents });
      } else {
        const item = (await reader.execute({ sql: 'SELECT transaction_date, amount_cents, payee, actual_account_id, actual_category_id, imported_id, evidence_json, financial_email_plan_json FROM ea_transaction_import_items WHERE user_id=? AND id=?', args: [userId, String(occurrence.record_id)] })).rows;
        sources.push({ occurrence, item });
      }
    }
    return createHash('sha256').update(correctionJson(sources)).digest('hex');
  }
  async function hydrate(row: Row | undefined): Promise<FinancialCorrection | null> {
    if (!row) return null;
    const preview = (await client.execute({ sql: 'SELECT preview_json FROM ea_financial_correction_previews WHERE id=?', args: [String(row.preview_id)] })).rows[0];
    const steps = (await client.execute({ sql: 'SELECT * FROM ea_financial_correction_steps WHERE correction_id=? ORDER BY position', args: [String(row.id)] })).rows;
    return { id: String(row.id), preview: JSON.parse(String(preview!.preview_json)) as FinancialCorrectionPreview,
      state: row.state as FinancialCorrection['state'], executionStopped: !!row.execution_stopped,
      revision: Number(row.revision), updatedAt: Number(row.updated_at), effectiveResult: row.effective_result_json ? JSON.parse(String(row.effective_result_json)) : null,
      steps: steps.map(step => ({ step: JSON.parse(String(step.step_json)), attemptedAt: step.attempted_at == null ? null : Number(step.attempted_at),
        state: step.state as CorrectionStepStatus['state'], observed: step.observed_json ? JSON.parse(String(step.observed_json)) : null, error: step.error == null ? null : String(step.error) })) };
  }
  async function read(userId: string, id: string) {
    return hydrate((await client.execute({ sql: 'SELECT * FROM ea_financial_corrections WHERE user_id=? AND id=?', args: [userId, id] })).rows[0]);
  }
  return {
    sourceRevision, read,
    async saveKeepPreview(userId: string, preview: FinancialCorrectionKeepPreview) {
      await client.execute({ sql:'INSERT INTO ea_financial_correction_keep_previews VALUES(?,?,?,?,?)', args:[preview.id,userId,preview.correctionId,JSON.stringify(preview),preview.reviewedAt] });
    },
    async keepPreview(userId: string, id: string): Promise<FinancialCorrectionKeepPreview> {
      const row = (await client.execute({ sql:'SELECT preview_json FROM ea_financial_correction_keep_previews WHERE id=? AND user_id=?', args:[id,userId] })).rows[0];
      if (!row) correctionConstraint('The result review was not found. Read Actual again.');
      return JSON.parse(String(row.preview_json));
    },
    async keep(userId: string, preview: FinancialCorrectionKeepPreview, effective: unknown) {
      const tx = await client.transaction('write');
      try {
        const row = (await tx.execute({ sql:'SELECT * FROM ea_financial_corrections WHERE id=? AND user_id=?', args:[preview.correctionId,userId] })).rows[0];
        if (!row || row.state !== 'attention' || !row.execution_stopped || Number(row.revision) !== preview.correctionRevision) correctionConstraint('The correction changed. Review the current result again.');
        const latest = (await tx.execute({ sql:'SELECT id FROM ea_financial_corrections WHERE user_id=? AND activity_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1', args:[userId,String(row.activity_id)] })).rows[0];
        if (latest?.id !== preview.correctionId || await sourceRevision(userId,String(row.activity_id),tx) !== preview.sourceRevision) correctionConstraint('The source or correction changed. Review the current result again.');
        await tx.execute({ sql:"INSERT INTO ea_financial_correction_observations(correction_id,position,state,observed_json,error,observed_at) VALUES(?,-1,'kept_actual',?,NULL,?)", args:[preview.correctionId,JSON.stringify(preview.snapshot),Date.now()] });
        await tx.execute({ sql:"UPDATE ea_financial_corrections SET state='completed',effective_result_json=?,invalidation_pending=1,revision=revision+1,updated_at=? WHERE id=?", args:[JSON.stringify(effective),Date.now(),preview.correctionId] });
        await tx.execute({ sql: `UPDATE ea_financial_events SET status='settled', claim_token=NULL, claimed_at=NULL,
          reason='You kept the current Actual result. No further correction was applied.'
          WHERE user_id=? AND id IN(SELECT record_id FROM ea_financial_corrected_sources WHERE user_id=? AND activity_id=? AND owner='event')`, args: [userId, userId, String(row.activity_id)] });
        await tx.commit();
      } finally { tx.close(); }
      return (await read(userId,preview.correctionId))!;
    },
    async latest(userId: string, activityId: string) {
      return hydrate((await client.execute({ sql: 'SELECT * FROM ea_financial_corrections WHERE user_id=? AND activity_id=? ORDER BY updated_at DESC, rowid DESC LIMIT 1', args: [userId, activityId] })).rows[0]);
    },
    async byKey(userId: string, key: string) {
      return hydrate((await client.execute({ sql: 'SELECT * FROM ea_financial_corrections WHERE user_id=? AND idempotency_key=?', args: [userId, key] })).rows[0]);
    },
    async savePreview(userId: string, preview: FinancialCorrectionPreview) {
      await client.execute({ sql: 'INSERT INTO ea_financial_correction_previews VALUES (?,?,?,?,?)', args: [preview.id, userId, preview.activityId, JSON.stringify(preview), preview.createdAt] });
    },
    async preview(userId: string, id: string): Promise<FinancialCorrectionPreview> {
      const row = (await client.execute({ sql: 'SELECT preview_json FROM ea_financial_correction_previews WHERE user_id=? AND id=?', args: [userId, id] })).rows[0];
      if (!row) correctionConstraint('Correction preview not found.');
      return JSON.parse(String(row.preview_json)) as FinancialCorrectionPreview;
    },
    async admit(userId: string, preview: FinancialCorrectionPreview, key: string) {
      const tx = await client.transaction('write');
      try {
        if (await sourceRevision(userId, preview.activityId, tx) !== preview.sourceRevision) correctionConstraint('The source changed after this preview. Refresh the preview.');
        const latest = (await tx.execute({ sql: 'SELECT id FROM ea_financial_corrections WHERE user_id=? AND activity_id=? ORDER BY updated_at DESC, rowid DESC LIMIT 1', args: [userId, preview.activityId] })).rows[0];
        if ((latest ? String(latest.id) : null) !== preview.predecessorId) correctionConstraint('A newer correction exists. Refresh the preview.');
        const active = (await tx.execute({ sql: "SELECT * FROM ea_financial_corrections WHERE user_id=? AND budget_id=? AND state IN ('applying','recovering','attention')", args: [userId, preview.budgetId] })).rows;
        for (const row of active) {
          if (row.id !== preview.predecessorId || !row.execution_stopped) correctionConstraint('Another correction is active for this budget.');
          const unsettled = (await tx.execute({ sql: "SELECT 1 FROM ea_financial_correction_steps WHERE correction_id=? AND attempted_at IS NOT NULL AND state NOT IN ('applied','no_write','partial')", args: [String(row.id)] })).rows;
          if (unsettled.length) correctionConstraint('An uncertain attempted step cannot be superseded.');
          await tx.execute({ sql: "UPDATE ea_financial_corrections SET state='superseded', revision=revision+1 WHERE id=?", args: [String(row.id)] });
        }
        await tx.execute({ sql: `INSERT INTO ea_financial_corrections(id,user_id,activity_id,budget_id,preview_id,idempotency_key,predecessor_id,state,updated_at) VALUES(?,?,?,?,?,?,?,'applying',?)`, args: [preview.id, userId, preview.activityId, preview.budgetId, preview.id, key, preview.predecessorId, Date.now()] });
        for (const [index, step] of preview.steps.entries()) await tx.execute({ sql: 'INSERT INTO ea_financial_correction_steps(correction_id,position,step_json) VALUES(?,?,?)', args: [preview.id, index, JSON.stringify(step)] });
        await tx.execute({ sql: 'INSERT OR IGNORE INTO ea_financial_correction_guards VALUES(?,?)', args: [userId, preview.activityId] });
        await tx.execute({ sql: `UPDATE ea_financial_events SET status='settled', claim_token=NULL, claimed_at=NULL
          WHERE user_id=? AND id IN(SELECT record_id FROM ea_financial_corrected_sources WHERE user_id=? AND activity_id=? AND owner='event')`, args: [userId, userId, preview.activityId] });
        await tx.execute({ sql: `UPDATE ea_transaction_import_items SET status='needs_review', claim_token=NULL, claimed_at=NULL, automatic_safe=0
          WHERE user_id=? AND id IN(SELECT record_id FROM ea_financial_corrected_sources WHERE user_id=? AND activity_id=? AND owner='import') AND status NOT IN('added','updated','already_present')`, args: [userId, userId, preview.activityId] });
        await tx.commit();
      } finally { tx.close(); }
      return (await read(userId, preview.id))!;
    },
    async attempt(userId: string, preview: FinancialCorrectionPreview, position: number): Promise<boolean> {
      const tx = await client.transaction('write');
      try {
        if (await sourceRevision(userId, preview.activityId, tx) !== preview.sourceRevision) correctionConstraint('Source evidence changed before the next correction step.');
        const result = await tx.execute({ sql: "UPDATE ea_financial_correction_steps SET attempted_at=?, state='uncertain' WHERE correction_id=? AND position=? AND attempted_at IS NULL", args: [Date.now(), preview.id, position] });
        if (result.rowsAffected) await tx.execute({ sql: 'UPDATE ea_financial_corrections SET execution_stopped=0, revision=revision+1 WHERE id=?', args: [preview.id] });
        await tx.commit();
        return result.rowsAffected === 1;
      } finally { tx.close(); }
    },
    async settle(id: string, position: number, result: Pick<CorrectionStepStatus, 'state' | 'observed' | 'error'> & { localObserved?: CorrectionStepStatus['observed'] }) {
      await client.batch([
        ...(result.localObserved ? [{ sql: 'INSERT INTO ea_financial_correction_observations(correction_id,position,state,observed_json,error,observed_at) VALUES(?,?,?,?,?,?)', args: [id, position, 'local_observed', JSON.stringify(result.localObserved), result.error, Date.now()] }] : []),
        { sql: 'INSERT INTO ea_financial_correction_observations(correction_id,position,state,observed_json,error,observed_at) VALUES(?,?,?,?,?,?)', args: [id, position, result.state, JSON.stringify(result.observed), result.error, Date.now()] },
        { sql: 'UPDATE ea_financial_correction_steps SET state=?, observed_json=?, error=? WHERE correction_id=? AND position=?', args: [result.state, JSON.stringify(result.observed), result.error, id, position] },
        { sql: 'UPDATE ea_financial_corrections SET execution_stopped=1, revision=revision+1, updated_at=? WHERE id=?', args: [Date.now(), id] },
      ], 'write');
    },
    async state(id: string, state: FinancialCorrection['state'], effective: unknown = null) {
      await client.execute({ sql: `UPDATE ea_financial_corrections SET state=?, effective_result_json=COALESCE(?, effective_result_json), invalidation_pending=CASE WHEN ?='completed' THEN 1 ELSE invalidation_pending END, revision=revision+1, updated_at=? WHERE id=?`, args: [state, effective === null ? null : JSON.stringify(effective), state, Date.now(), id] });
    },
    async invalidated(id: string) { await client.execute({ sql: 'UPDATE ea_financial_corrections SET invalidation_pending=0 WHERE id=?', args: [id] }); },
    async pending() {
      return (await client.execute("SELECT user_id,id FROM ea_financial_corrections WHERE state IN ('applying','recovering') OR invalidation_pending=1 ORDER BY updated_at LIMIT 10")).rows.map(row => ({ userId: String(row.user_id), id: String(row.id) }));
    },
  };
}
