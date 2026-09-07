import type { CorrectionRow, CorrectionSnapshot, CorrectionStep, CorrectionStepStatus } from '../../shared/types/financial-corrections.ts';
import { correctionJson, correctionConditions, decodeCorrectionJson, readCorrectionSnapshot } from './actualCorrectionEvidence.ts';
import type { ActualEvidencePort } from './actualOriginalEvidence.ts';

export interface ActualCorrectionPort extends ActualEvidencePort {
  sync(): Promise<void>;
  internal: ActualEvidencePort['internal'] & { send(command: string, payload: unknown): Promise<unknown> };
}
const matches = (row: CorrectionRow | undefined, expected: CorrectionRow) => !!row && Object.entries(expected).every(([key, value]) => correctionJson(row[key]) === correctionJson(value));
const normalizedConditions = (values: unknown[]) => values.map(value => {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'type').map(([key, entry]) => [key, key === 'field' ? ({ acct: 'account', description: 'payee' }[String(entry)] || entry) : entry]));
}).sort((a, b) => correctionJson(a).localeCompare(correctionJson(b)));

const normalizedActions = (values: unknown[]) => values.map(value => !value || typeof value !== 'object' ? value
  : Object.fromEntries(Object.entries(value).filter(([key, entry]) => key !== 'type' && !(key === 'field' && entry == null))));

/** Every command also preserves resources outside its explicitly planned mutation. */
function preservesOtherResources(step: CorrectionStep, before: CorrectionSnapshot, after: CorrectionSnapshot): boolean {
  const scheduleId = step.after.schedule?.id || step.after.removedScheduleId;
  const ruleIds = new Set([step.after.removedRuleId, ...before.schedules.filter(row => row.id === scheduleId).map(row => row.rule), ...after.schedules.filter(row => row.id === scheduleId).map(row => row.rule), ...after.rules.filter(row => scheduleId && decodeCorrectionJson(row.actions).some(action => !!action && typeof action === 'object' && 'op' in action && action.op === 'link-schedule' && 'value' in action && action.value === scheduleId)).map(row => row.id)]);
  const transactionIds = new Set(step.after.transactions?.map(row => row.id));
  const unchanged = (snapshot: CorrectionSnapshot) => ({ ...snapshot,
    transactions: snapshot.transactions.filter(row => !transactionIds.has(row.id)),
    schedules: snapshot.schedules.filter(row => row.id !== scheduleId),
    scheduleNames: snapshot.scheduleNames.filter(row => row.id !== scheduleId),
    rules: snapshot.rules.filter(row => !ruleIds.has(row.id)),
    dates: snapshot.dates.filter(row => row.schedule_id !== scheduleId),
  });
  return correctionJson(unchanged(before)) === correctionJson(unchanged(after));
}

export function observeCorrectionStep(step: CorrectionStep, observed: CorrectionSnapshot, before = step.before): CorrectionStepStatus['state'] {
  const expected = step.after;
  if (expected.ruleActions) {
    const parent = observed.schedules.find(row => row.id === expected.ruleActions!.scheduleId && !row.tombstone);
    const rule = observed.rules.find(row => row.id === parent?.rule && !row.tombstone);
    if (!rule || correctionJson(normalizedActions(decodeCorrectionJson(rule.actions))) !== correctionJson(normalizedActions(expected.ruleActions.actions))) return 'uncertain';
    const preserved = (snapshot: CorrectionSnapshot) => ({ ...snapshot, rules: snapshot.rules.map(row => row.id === rule.id ? { ...row, actions: null } : row) });
    return correctionJson(preserved(before)) === correctionJson(preserved(observed)) ? 'applied' : 'conflict';
  }
  if (!preservesOtherResources(step, before, observed)) return 'conflict';
  if (expected.transactions) return expected.transactions.every(row => matches(observed.transactions.find(entry => entry.id === row.id), row)) ? 'applied' : 'uncertain';
  if (expected.removedRuleId) return observed.rules.some(row => row.id === expected.removedRuleId && row.tombstone) ? 'applied' : 'uncertain';
  if (expected.removedScheduleId) return observed.schedules.some(row => row.id === expected.removedScheduleId && row.tombstone)
    && observed.rules.filter(row => step.before.schedules.some(parent => parent.id === expected.removedScheduleId && parent.rule === row.id)).every(row => row.tombstone) ? 'applied' : 'uncertain';
  if (expected.schedule) {
    const parent = observed.schedules.find(row => row.id === expected.schedule!.id && !row.tombstone);
    const linkedRules = observed.rules.filter(row => decodeCorrectionJson(row.actions).some(action => action && typeof action === 'object' && 'op' in action && action.op === 'link-schedule' && 'value' in action && action.value === expected.schedule!.id));
    const rule = linkedRules.length === 1 && linkedRules[0]?.id === parent?.rule && !linkedRules[0]?.tombstone ? linkedRules[0] : undefined;
    const dates = observed.dates.filter(row => row.schedule_id === expected.schedule!.id);
    const scheduleFields = { ...expected.schedule }; delete scheduleFields.rule;
    if (parent && matches(parent, scheduleFields) && rule && dates.length === 1 && !dates[0]!.tombstone
      && (!expected.scheduleActions || correctionJson(normalizedActions(decodeCorrectionJson(rule.actions))) === correctionJson(normalizedActions(expected.scheduleActions)))
      && (expected.nextDate === undefined || (dates[0]!.local_next_date_ts === dates[0]!.base_next_date_ts ? dates[0]!.local_next_date : dates[0]!.base_next_date) === expected.nextDate)
      && correctionJson(normalizedConditions(decodeCorrectionJson(rule.conditions))) === correctionJson(normalizedConditions(expected.conditions || []))) return 'applied';
    if (!parent && (linkedRules.length || dates.length)) {
      if (linkedRules.length > 1 || dates.length > 1 || (linkedRules[0] && correctionJson(normalizedConditions(decodeCorrectionJson(linkedRules[0].conditions))) !== correctionJson(normalizedConditions(expected.conditions || [])))) return 'conflict';
      return 'partial';
    }
  }
  return 'uncertain';
}

/** Dispatch is never used for recovery. The caller must durably record its attempt first. */
export async function executeCorrectionStep(sdk: ActualCorrectionPort, budgetId: string, step: CorrectionStep, before = step.before): Promise<{ localObserved: CorrectionSnapshot; observed: CorrectionSnapshot; state: CorrectionStepStatus['state']; error: string | null }> {
  let error: string | null = null;
  try {
    if (step.command === 'schedule/rule-update') {
      const parent = before.schedules.find(row => row.id === step.after.ruleActions?.scheduleId && !row.tombstone);
      const rule = before.rules.find(row => row.id === parent?.rule && !row.tombstone);
      if (!rule) throw new Error('The bound schedule rule is missing.');
      const response = await sdk.internal.send('rule-update', { id: rule.id, stage: rule.stage, conditionsOp: rule.conditions_op,
        conditions: correctionConditions(rule.conditions), actions: step.after.ruleActions!.actions });
      if (response && typeof response === 'object' && 'error' in response) throw new Error('Actual rejected the schedule rule update.');
    } else await sdk.internal.send(step.command, step.payload);
  }
  catch (failure) { error = failure instanceof Error ? failure.message : 'Actual correction command failed'; }
  // The awaited command has stopped. Preserve local evidence even if synchronization fails.
  const local = await readCorrectionSnapshot(sdk, budgetId, step.targets);
  try { await sdk.sync(); }
  catch (failure) { return { localObserved: local, observed: local, state: 'uncertain', error: failure instanceof Error ? failure.message : 'Actual synchronization failed' }; }
  const observed = await readCorrectionSnapshot(sdk, budgetId, step.targets);
  let state = observeCorrectionStep(step, observed, before);
  // A completed, awaited failure and unchanged local + synced state prove no write.
  // Recovery after process loss never makes this inference from a remote before-state.
  if (error && state === 'uncertain' && correctionJson(local) === correctionJson(before) && correctionJson(observed) === correctionJson(before)) state = 'no_write';
  return { localObserved: local, observed, state, error };
}
