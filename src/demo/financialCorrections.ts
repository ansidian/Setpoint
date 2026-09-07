import type { FinancialActivity, FinancialActivityReference, FinancialWriteEvidence } from '../../shared/types/financial-activity';
import type { CorrectionSnapshot, CorrectionStep, FinancialCorrection, FinancialCorrectionDraft, FinancialCorrectionPreview } from '../../shared/types/financial-corrections';
import { demoNotFound, type DemoRequestBody } from './apiHandler';
import { getDemoSeed } from './store';
import { currentDemoFinanceSnapshot, publishDemoFinanceSnapshot, announceDemoFinanceChange } from './financeProjection';

const previews = new Map<string, FinancialCorrectionPreview>();
const corrections = new Map<string, FinancialCorrection>();
const latest = new Map<string, string>();
const clone = <T>(value: T): T => structuredClone(value);
const key = (reference: FinancialActivityReference) => JSON.stringify(reference);
export function getDemoCorrection(reference: FinancialActivityReference): FinancialCorrection | null {
  return clone(corrections.get(latest.get(key(reference)) || '') || null);
}

function constraint(message: string): never {
  throw Object.assign(new Error(message), { status: 409, code: 'FINANCIAL_CORRECTION_CONSTRAINT' });
}

export function projectDemoCorrection(activity: FinancialActivity): FinancialActivity {
  seedDemoRecovery(activity);
  const correction = corrections.get(latest.get(key(activity.reference)) || '');
  if (!correction) return activity;
  const entry = (correction.effectiveResult as { entry?: FinancialCorrectionDraft & { payee?: string } } | null)?.entry;
  return { ...activity, ...(entry ? { payee: entry.payee || activity.payee, amountCents: entry.amountCents * (entry.type === 'income' ? 1 : -1) } : {}), status: correction.state === 'completed' ? 'completed' : activity.status, effectiveResult: clone(correction.effectiveResult),
    correction: { id: correction.id, state: correction.state, revision: correction.revision },
    history: { emails:activity.history?.emails || [], corrections:[...corrections.values()].filter(item => item.preview.activityId === activity.id).map(item => ({ id:item.id,predecessorId:item.preview.predecessorId,state:item.state,updatedAt:item.updatedAt,steps:item.steps.map(({ state,attemptedAt }) => ({ state,attemptedAt })) })) },
    actions: { ...activity.actions, correct: correction.state === 'completed' || correction.state === 'attention' },
    reason: correction.state === 'completed' ? 'Correction saved to the fictional budget.' : correction.state === 'recovering' ? 'Checking the earlier correction. Its outcome is still uncertain.' : 'The amount change is saved. Preview the remaining date change explicitly.', updatedAt: correction.updatedAt };
}

function snapshot(activity: FinancialActivity): CorrectionSnapshot {
  const correction = corrections.get(latest.get(key(activity.reference)) || '');
  const observed = correction?.steps[correction.steps.length - 1]?.observed;
  if (observed) return currentDemoFinanceSnapshot(observed);
  const metadata = getDemoSeed().actualMetadata;
  const hasSchedule = activity.originalReceipts.some(receipt => receipt.evidence?.objects.some(object => object.kind === 'schedule'));
  const date = Number(getDemoSeed().dateKey.replace(/-/g, ''));
  const payeeId = hasSchedule ? activity.reference.id === 'demo-event-uncertain' ? 'demo-payee-water' : 'demo-payee-electric' : `demo-payee-${activity.reference.id}`;
  const evidence = activity.originalReceipts.find(receipt => receipt.evidence)?.evidence;
  const schedule = evidence?.objects.find(object => object.kind === 'schedule');
  const scheduleId = schedule?.id || 'demo-shared-schedule';
  const ruleId = String(schedule?.after?.rule || 'demo-schedule-rule');
  return currentDemoFinanceSnapshot({ budgetId: 'demo-budget', transactions: evidence?.objects.filter(o => o.kind === 'transaction').map(o => ({ ...o.after, id: o.id })) || [],
    schedules: evidence?.objects.filter(o => o.kind === 'schedule').map(o => ({ ...o.after, id: o.id })) || [],
    rules: hasSchedule ? [{ id: ruleId, conditions: [{ field: 'amount', op: 'is', value: -9000 }, { field: 'account', op: 'is', value: 'demo-checking' }, { field: 'payee', op: 'is', value: payeeId }, { field: 'date', op: 'is', value: { frequency: 'monthly', interval: 1, patterns: [{ type: 'day', value: 15 }], start: getDemoSeed().dateKey } }], actions: [{ op: 'set', field: 'category', value: 'demo-utilities' }], tombstone: 0 }] : [], dates: hasSchedule ? [{ id: `${scheduleId}-date`, schedule_id: scheduleId, local_next_date: date, base_next_date: date, local_next_date_ts:0, base_next_date_ts:0 }] : [], accounts: clone(metadata.accounts), payees: [...clone(metadata.payees), { id: payeeId, name: activity.payee || 'Fictional payee' }],
    categories: metadata.categories.flatMap(group => clone(group.categories)), scheduleNames: hasSchedule ? [{ id: scheduleId, name: String(schedule?.after?.name || 'Fictional Electric') }] : [] });
}

function seedDemoRecovery(activity: FinancialActivity): void {
  const partial = activity.reference.id === 'demo-event-partial';
  if ((!partial && activity.reference.id !== 'demo-event-uncertain') || latest.has(key(activity.reference))) return;
  const current = snapshot(activity);
  const id = partial ? 'demo-correction-partial' : 'demo-correction-recovering';
  const date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const draft: FinancialCorrectionDraft = { type: 'bill', amountCents: 9000, date, accountId: 'demo-checking', payeeId: `demo-payee-${activity.reference.id}`, categoryId: 'demo-utilities', targetScheduleId: current.schedules[0]?.id, name: activity.payee || 'Fictional bill' };
  const targets = { transactionIds: [], scheduleIds: current.schedules.map(row => row.id), ruleIds: current.rules.map(row => row.id) };
  const step: CorrectionStep = { id: `${id}-step`, command: 'schedule/update', payload: {}, before: clone(current), targets,
    after: { schedule: current.schedules[0], conditions: (current.rules[0]?.conditions as Array<{ field: string; value: unknown }>).map(condition => condition.field === 'amount' ? { ...condition, value: -9000 } : condition), nextDate: Number(date.replace(/-/g, '')) } };
  const preview: FinancialCorrectionPreview = { id, activityId: activity.id, reference: activity.reference, budgetId: 'demo-budget', sourceRevision: '1', predecessorId: null, draft,
    originalReceipts: clone(activity.originalReceipts), evidence: clone(activity.originalReceipts[0]!.evidence!), snapshot: clone(current), targets, steps: [step], createdAt: activity.createdAt + 14 * 60_000 };
  const observed = partial ? clone(current) : null;
  if (observed) observed.rules[0] = { ...observed.rules[0]!, conditions: clone(step.after.conditions) };
  const correction: FinancialCorrection = { id, preview, state: partial ? 'attention' : 'recovering', executionStopped: partial,
    steps: [{ step, attemptedAt: activity.createdAt + 15 * 60_000, state: partial ? 'partial' : 'uncertain', observed, error: partial ? 'The amount change is present; the new date was not applied.' : 'The attempted schedule change cannot yet be verified.' }], revision: 1, effectiveResult: null, updatedAt: activity.createdAt + 18 * 60_000 };
  if (observed) publishDemoFinanceSnapshot(current, observed);
  corrections.set(id, correction);
  latest.set(key(activity.reference), id);
}

export function handleDemoCorrection(url: URL, method: string, body: DemoRequestBody, all: FinancialActivity[]): unknown {
  if (method === 'GET') return clone(corrections.get(decodeURIComponent(url.pathname.split('/').slice(-1)[0]!)) || demoNotFound(url.pathname));
  if (url.pathname.endsWith('/confirm')) {
    const preview = previews.get(String(body.previewId));
    if (!preview) return demoNotFound(url.pathname);
    const existing = corrections.get(preview.id);
    if (existing) return clone(existing);
    const current = latest.get(key(preview.reference)) || null;
    if (current !== preview.predecessorId || JSON.stringify(currentDemoFinanceSnapshot(preview.snapshot)) !== JSON.stringify(preview.snapshot)) constraint('This record changed after preview. Refresh the preview before saving.');
    const observed = clone(preview.snapshot);
    for (const step of preview.steps) {
      if (step.after.transactions) observed.transactions = clone(step.after.transactions);
      if (step.after.schedule) observed.schedules = [clone(step.after.schedule)];
      if (step.after.conditions) observed.rules = [{ ...observed.rules[0], id: String(step.after.schedule?.rule || 'demo-schedule-rule'), conditions: clone(step.after.conditions), actions: clone(step.after.scheduleActions || []) }];
      if (step.after.nextDate) observed.dates = [{ id: `${observed.schedules[0]?.id}-date`, schedule_id: observed.schedules[0]?.id, base_next_date: step.after.nextDate, local_next_date: step.after.nextDate, local_next_date_ts:0, base_next_date_ts:0 }];
      if (step.after.removedScheduleId) { observed.schedules = []; observed.rules = []; observed.dates = []; }
    }
    const correction: FinancialCorrection = { id: preview.id, preview: clone(preview), state: 'completed', executionStopped: true,
      steps: preview.steps.map(step => ({ step: clone(step), attemptedAt: Date.now(), state: 'applied', observed: clone(observed), error: null })),
      revision: 1, effectiveResult: { outcome: 'updated', correctionId: preview.id, entry: { ...clone(preview.draft), payee: observed.payees.find(payee => payee.id === preview.draft.payeeId)?.name || preview.draft.name || all.find(activity => key(activity.reference) === key(preview.reference))?.payee || 'Fictional payee', kind: preview.draft.type === 'payment' ? 'expense' : preview.draft.type, amount: preview.draft.amountCents / 100 }, evidence: { budgetId: 'demo-budget', objects: [...observed.transactions.map((row, index) => ({ kind: 'transaction', id: row.id, role: index === 0 ? 'primary' : 'counterpart', provenance: 'updated', beforeState: 'captured', before: preview.snapshot.transactions.find(before => before.id === row.id) || null, after: row })), ...observed.schedules.map(row => ({ kind: 'schedule', id: row.id, role: 'primary', provenance: preview.evidence.objects.find(object => object.kind === 'schedule' && object.id === row.id)?.provenance || 'created', beforeState: preview.evidence.objects.find(object => object.kind === 'schedule' && object.id === row.id)?.beforeState || 'confirmed_absent', before: preview.evidence.objects.find(object => object.kind === 'schedule' && object.id === row.id)?.before || null, after: row }))] }, transactionId: observed.transactions[0]?.id, scheduleId: observed.schedules[0]?.id }, updatedAt: Date.now() };
    if (current) { const predecessor = corrections.get(current); if (predecessor?.state === 'attention') predecessor.state = 'superseded'; }
    publishDemoFinanceSnapshot(preview.snapshot, observed);
    corrections.set(correction.id, correction);
    latest.set(key(preview.reference), correction.id);
    announceDemoFinanceChange();
    return clone(correction);
  }
  const reference = body.reference as FinancialActivityReference;
  const activity = all.find(item => key(item.reference) === key(reference));
  if (!activity) return demoNotFound(url.pathname);
  if (reference.id === 'demo-event-disconnected') throw Object.assign(new Error('Actual is disconnected for this saved record. Reconnect its original budget in Connections; the saved receipt remains available.'), { status: 503, code: 'ACTUAL_UNAVAILABLE' });
  const current = snapshot(activity);
  const predecessorId = latest.get(key(reference)) || null;
  const previousResult = predecessorId ? corrections.get(predecessorId)?.effectiveResult as { evidence?: FinancialWriteEvidence } : null;
  const evidence = previousResult?.evidence || activity.originalReceipts.find(receipt => receipt.evidence)?.evidence || { budgetId: 'demo-budget', objects: [] };
  if (url.pathname.endsWith('/inspect')) return clone({ reference, activityId: activity.id, budgetId: 'demo-budget', evidence,
    snapshot: current, originalReceipts: activity.originalReceipts, correction: predecessorId ? corrections.get(predecessorId) : null });
  if (predecessorId && corrections.get(predecessorId)?.state === 'recovering') constraint('The earlier attempted change remains uncertain. Wait for recovery before starting another correction.');
  if (!activity.actions.correct) constraint('This record is not available for correction.');
  const draft = body.draft as FinancialCorrectionDraft;
  if (!draft || !Number.isInteger(draft.amountCents) || draft.amountCents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) constraint('Enter a positive amount and valid date.');
  if (draft.type === 'transfer' ? !draft.fromAccountId || !draft.toAccountId || draft.fromAccountId === draft.toAccountId : !draft.accountId) constraint('Choose the accounts for this record.');
  if (current.schedules.length && draft.type !== 'bill' && !draft.scheduleTreatment) constraint('Choose what happens to the existing schedule.');
  if (draft.scheduleTreatment === 'retire' && evidence.objects.some(object => object.kind === 'schedule' && object.provenance !== 'created')) constraint('This existing schedule was updated by the original operation. Its creation is not proven, so it cannot be retired here. Keep it or amend the current schedule.');
  if (draft.scheduleTreatment === 'restore') constraint('The original schedule snapshot is unavailable. Keep the current schedule or retire it explicitly.');
  const id = `demo-correction-${previews.size + 1}`;
  const targets = { transactionIds: current.transactions.map(row => row.id), scheduleIds: current.schedules.map(row => row.id), ruleIds: current.rules.map(row => row.id) };
  const steps: CorrectionStep[] = [];
  if (draft.targetScheduleId && draft.targetScheduleId !== current.schedules[0]?.id) constraint('Only the exact bound schedule can be edited.');
  if (draft.type !== 'transfer' && draft.type !== 'bill' && current.transactions.length > 1 && !draft.retainTransactionId) constraint('Choose the transfer entry to retain.');
  if (draft.type === 'bill') {
    if (current.transactions.length) steps.push({ id: `${id}-remove-ledger`, command: 'transactions-batch-update', payload: {}, targets, before: current, after: { transactions: [] } });
    const schedule = { id: current.schedules[0]?.id || `${id}-schedule`, name: draft.name || activity.payee || 'Bill', rule: current.schedules[0]?.rule || `${id}-rule`, tombstone: 0 };
    const conditions = [{ field: 'amount', op: 'is', value: -draft.amountCents }, { field: 'account', op: 'is', value: draft.accountId }, { field: 'payee', op: 'is', value: draft.payeeId || null }, { field: 'date', op: 'is', value: (current.rules[0]?.conditions as Array<{ field: string; value: unknown }> | undefined)?.find(condition => condition.field === 'date')?.value || draft.date }];
    const scheduleActions = [{ op: 'set', field: 'category', value: draft.categoryId || null }];
    steps.push({ id: `${id}-schedule-step`, command: current.schedules.length ? 'schedule/update' : 'schedule/create', payload: {}, targets, before: current, after: { schedule, conditions, scheduleActions, nextDate: Number(draft.date.replace(/-/g, '')) } });
  } else {
    const retained = current.transactions.find(row => row.id === draft.retainTransactionId) || current.transactions[0];
    const counterpartId = current.transactions.find(row => row.id !== retained?.id)?.id || `${id}-counterpart`;
    const primary = { ...retained, id: retained?.id || `${id}-transaction`, amount: draft.type === 'income' ? draft.amountCents : -draft.amountCents, date: Number(draft.date.replace(/-/g, '')), acct: draft.type === 'transfer' ? draft.fromAccountId : draft.accountId, description: draft.payeeId || null, category: draft.type === 'transfer' ? null : draft.categoryId || null, notes: draft.notes || '', transferred_id: null };
    const transactions = draft.type === 'transfer' ? [{ ...primary, transferred_id: counterpartId }, { ...primary, id: counterpartId, amount: draft.amountCents, acct: draft.toAccountId, transferred_id: primary.id }] : [primary];
    steps.push({ id: `${id}-ledger`, command: 'transactions-batch-update', payload: {}, targets, before: current, after: { transactions } });
    if (draft.scheduleTreatment === 'retire' && current.schedules[0]) steps.push({ id: `${id}-retire`, command: 'schedule/delete', payload: {}, targets, before: current, after: { removedScheduleId: current.schedules[0].id } });
  }
  const preview: FinancialCorrectionPreview = { id, reference, activityId: activity.id, budgetId: 'demo-budget', sourceRevision: predecessorId || '1', predecessorId, draft: clone(draft), originalReceipts: clone(activity.originalReceipts), evidence: clone(evidence), snapshot: current, targets, steps, createdAt: Date.now() };
  previews.set(id, preview);
  return clone(preview);
}
