import { correctionSuccessorSteps, correctionSuccessorContext } from './financial-correction-successor.ts';
import { correctionResult } from './financial-correction-result.ts';
import { publishCurrentDashboardEvent } from '../dashboard/current-events.ts';
import { randomUUID } from 'node:crypto';
import type { FinancialActivityReference, FinancialWriteEvidence } from '../../shared/types/financial-activity.ts';
import type { FinancialCorrectionDraft, FinancialCorrectionPreview, FinancialCorrectionInspection, CorrectionSnapshot } from '../../shared/types/financial-corrections.ts';
import { financialActivityReader } from '../financial-activity/financial-activity.ts';
import { inspectCorrection, dispatchCorrection } from '../actual/actual.ts';
import { coordinateActualWrite } from '../actual/actual.ts';
import { correctionJson } from '../actual/actual.ts';
import { observeCorrectionStep } from '../actual/actual.ts';
import { createFinancialCorrectionStore } from './financial-correction-store.ts';
import { correctionConstraint, planFinancialCorrection } from './financial-correction-model.ts';
import { invalidateActualAfterTransactionImport } from '../bills/bills-service.ts';

async function publishCorrection(userId: string) {
  await invalidateActualAfterTransactionImport(userId);
  publishCurrentDashboardEvent(userId, { source: 'email_triage', reason: 'financial_event_changed', state: 'current' });
}

export function createFinancialCorrections({ store = createFinancialCorrectionStore(), reader = financialActivityReader,
  inspect = inspectCorrection, dispatch = dispatchCorrection, changed = publishCorrection } = {}) {
  async function resolve(userId: string, reference: FinancialActivityReference, targetScheduleId?: string) {
    const activity = await reader.detail(userId, reference);
    if (!activity?.originalReceipts.length) correctionConstraint('This activity has no completed original result.');
    const previous = await store.latest(userId, activity.id);
    const effective = previous?.effectiveResult as { evidence?: FinancialWriteEvidence } | null;
    const evidence = effective?.evidence || previous?.preview.evidence || activity.targetBindings[0] || activity.originalReceipts[0]?.evidence;
    if (!evidence?.objects.length || activity.targetBindings.length > 1) correctionConstraint('Resolve exact targets in one Actual budget before correcting.');
    const targets = { transactionIds: evidence.objects.filter(row => row.kind === 'transaction').map(row => row.id),
      scheduleIds: evidence.objects.filter(row => row.kind === 'schedule').map(row => row.id), ruleIds: evidence.objects.filter(row => row.kind === 'rule').map(row => row.id) };
    if (targetScheduleId) targets.scheduleIds.push(targetScheduleId);
    if (previous && previous.state !== 'completed') {
      targets.transactionIds.push(...previous.preview.targets.transactionIds);
      targets.scheduleIds.push(...previous.preview.targets.scheduleIds);
      targets.ruleIds.push(...previous.steps.flatMap(step => step.observed?.rules.map(row => row.id) || []));
    }
    return { activity, previous, evidence, targets };
  }
  async function inspectActivity(userId: string, reference: FinancialActivityReference): Promise<FinancialCorrectionInspection> {
    return coordinateActualWrite(async () => {
      const { activity, previous, evidence, targets } = await resolve(userId, reference);
      const snapshot = await inspect(userId, evidence.budgetId, targets);
      if (snapshot.budgetId !== evidence.budgetId) correctionConstraint('The selected Actual budget changed.');
      return { reference, activityId: activity.id, budgetId: evidence.budgetId,
        originalReceipts: activity.originalReceipts, evidence, snapshot, correction: previous };
    });
  }
  async function preview(userId: string, reference: FinancialActivityReference, draft: FinancialCorrectionDraft): Promise<FinancialCorrectionPreview> {
    return coordinateActualWrite(async () => {
      const { activity, previous, evidence, targets } = await resolve(userId, reference, draft?.targetScheduleId);
      const sourceRevision = await store.sourceRevision(userId, activity.id);
      if (previous && (!previous.executionStopped || previous.steps.some(step => step.attemptedAt !== null && !['applied', 'no_write', 'partial'].includes(step.state)))) correctionConstraint('The earlier correction has an uncertain attempted step; it cannot be bypassed.');
      const snapshot = await inspect(userId, evidence.budgetId, targets);
      if (snapshot.budgetId !== evidence.budgetId) correctionConstraint('The selected Actual budget changed.');
      const successorSteps = correctionSuccessorSteps(previous, snapshot);
      const successor = correctionSuccessorContext(previous, snapshot, evidence);
      const plan = planFinancialCorrection(snapshot, successor.evidence, draft, successor.context);
      plan.steps.unshift(...successorSteps);
      plan.targets.scheduleIds = [...new Set([...plan.targets.scheduleIds, ...targets.scheduleIds])];
      plan.targets.ruleIds = [...new Set([...plan.targets.ruleIds, ...targets.ruleIds])];
      // New IDs must also be proven absent in the bound preview.
      const bound = await inspect(userId, evidence.budgetId, plan.targets);
      if (correctionJson(bound) !== correctionJson(snapshot)) correctionConstraint('Actual changed while preparing the correction. Refresh the preview.');
      const result: FinancialCorrectionPreview = { id: randomUUID(), reference, activityId: activity.id, budgetId: evidence.budgetId,
        sourceRevision, predecessorId: previous?.id || null,
        draft: structuredClone(draft), originalReceipts: activity.originalReceipts, evidence: successor.evidence, snapshot: bound, targets: plan.targets,
        steps: plan.steps.map(step => ({ ...step, targets: plan.targets })), createdAt: Date.now() };
      if (sourceRevision !== await store.sourceRevision(userId, activity.id)) correctionConstraint('The source changed while preparing the preview.');
      await store.savePreview(userId, result);
      return result;
    });
  }
  async function confirm(userId: string, previewId: string, idempotencyKey: string) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) correctionConstraint('A bounded idempotency key is required.');
    return coordinateActualWrite(async () => {
      const existing = await store.byKey(userId, idempotencyKey);
      if (existing) {
        if (existing.preview.id !== previewId) correctionConstraint('This idempotency key belongs to another preview.');
        return existing;
      }
      const bound = await store.preview(userId, previewId);
      const current = await inspect(userId, bound.budgetId, bound.targets);
      if (correctionJson(current) !== correctionJson(bound.snapshot)) correctionConstraint('Actual changed after preview. Refresh the preview before saving.');
      return store.admit(userId, bound, idempotencyKey);
    });
  }
  async function invalidate(userId: string, id: string) {
    try { await changed(userId); await store.invalidated(id); }
    catch (error) { console.error('[Financial Corrections] Result publication will retry:', error instanceof Error ? error.message : String(error)); }
  }
  async function apply(userId: string, id: string) {
    return coordinateActualWrite(async () => {
      let correction = await store.read(userId, id);
      if (correction?.state === 'completed') { await invalidate(userId, id); return correction; }
      if (!correction || !['applying', 'recovering'].includes(correction.state)) return correction;
      try {
        let prior: CorrectionSnapshot = correction.preview.snapshot;
        for (const [index, entry] of correction.steps.entries()) {
          if (entry.state === 'applied' && entry.observed) { prior = entry.observed; continue; }
          const observed = await inspect(userId, correction.preview.budgetId, correction.preview.targets);
          if (entry.attemptedAt !== null) {
            const state = observeCorrectionStep(entry.step, observed, prior);
            if (state !== 'applied') {
              await store.settle(id, index, { state, observed, error: state === 'partial' ? 'The schedule graph is partially applied; an explicit successor is required.' : 'The attempted effect could not be verified.' });
              await store.state(id, state === 'partial' || state === 'conflict' ? 'attention' : 'recovering');
              return store.read(userId, id);
            }
            await store.settle(id, index, { state, observed, error: null });
            prior = observed;
            continue;
          }
          // Prior receipts bind full graph state, including generated schedule child IDs.
          if (correctionJson(observed) !== correctionJson(prior)) {
            await store.settle(id, index, { state: 'conflict', observed, error: 'Actual changed after the last verified state. Refresh the correction against its current effects.' });
            await store.state(id, 'attention');
            return store.read(userId, id);
          }
          try {
            if (!await store.attempt(userId, correction.preview, index)) return store.read(userId, id);
          } catch (error) {
            await store.settle(id, index, { state: 'conflict', observed, error: error instanceof Error ? error.message : 'Correction admission failed.' });
            throw error;
          }
          let result;
          try { result = await dispatch(userId, correction.preview.budgetId, entry.step, observed); }
          catch (error) {
            // A transport failure is not proof the worker stopped. No successor is admitted.
            await store.state(id, 'recovering');
            throw error;
          }
          await store.settle(id, index, result);
          if (result.state !== 'applied') {
            await store.state(id, result.state === 'uncertain' ? 'recovering' : 'attention');
            return store.read(userId, id);
          }
          prior = result.observed;
        }
        correction = (await store.read(userId, id))!;
        const final = await inspect(userId, correction.preview.budgetId, correction.preview.targets);
        if (correctionJson(final) !== correctionJson(prior)) {
          await store.state(id, 'attention');
          return store.read(userId, id);
        }
        await store.state(id, 'completed', correctionResult(correction.preview, final));
        await invalidate(userId, id);
        return store.read(userId, id);
      } catch (error) {
        await store.state(id, error && typeof error === 'object' && 'code' in error && error.code === 'FINANCIAL_CORRECTION_CONSTRAINT' ? 'attention' : 'recovering');
        throw error;
      }
    });
  }
  return { inspect: inspectActivity, preview, confirm, read: store.read, apply,
    async recoverPending() { for (const item of await store.pending()) await apply(item.userId, item.id); } };
}
export const financialCorrections = createFinancialCorrections();
