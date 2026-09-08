import type { FinancialActivity, FinancialActivityReference, FinancialWriteEvidence } from '../../shared/types/financial-activity';
import type { CorrectionSnapshot, CorrectionStep, FinancialCorrection, FinancialCorrectionDraft, FinancialCorrectionKeepPreview, FinancialCorrectionPreview } from '../../shared/types/financial-corrections';
import { demoNotFound, type DemoRequestBody } from './apiHandler';
import { getDemoSeed } from './store';
import { buildKeptFinancialResult } from '../../shared/financial-kept-result';
import { currentDemoFinanceSnapshot, publishDemoFinanceSnapshot, announceDemoFinanceChange } from './financeProjection';
import { createClientId } from '../lib/clientId';

const previews = new Map<string, FinancialCorrectionPreview>();
const corrections = new Map<string, FinancialCorrection>();
const keepPreviews = new Map<string, FinancialCorrectionKeepPreview>();
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
  const result = correction.effectiveResult as { entry?: FinancialCorrectionDraft & { payee?: string; signedAmountCents?: number }; resolution?: 'kept_actual' } | null;
  const entry = result?.entry;
  const kept = result?.resolution === 'kept_actual';
  return { ...activity, ...(entry ? { payee: entry.payee || activity.payee, amountCents: entry.signedAmountCents ?? entry.amountCents * (entry.type === 'income' ? 1 : -1) } : kept ? { amountCents: null } : {}), status: correction.state === 'completed' ? 'completed' : correction.state === 'applying' || correction.state === 'recovering' ? 'processing' : correction.state === 'attention' ? 'needs_attention' : activity.status, effectiveResult: clone(correction.effectiveResult),
    correction: { id: correction.id, state: correction.state, revision: correction.revision, ...(kept ? { resolution: 'kept_actual' as const } : {}) },
    history: { emails:activity.history?.emails || [], corrections:[...corrections.values()].filter(item => item.preview.activityId === activity.id).map(item => ({ id:item.id,predecessorId:item.preview.predecessorId,state:item.state,updatedAt:item.updatedAt,...((item.effectiveResult as { resolution?: string } | null)?.resolution === 'kept_actual' ? { resolution: 'kept_actual' as const } : {}),steps:item.steps.map(({ state,attemptedAt }) => ({ state,attemptedAt })) })) },
    actions: { ...activity.actions, complete: false, retry: false, correct: correction.state === 'completed' || correction.state === 'attention' },
    reason: kept ? 'Kept the current Actual result. No changes were written to the budget.' : correction.state === 'completed' ? 'Correction saved to the fictional budget.' : correction.state === 'recovering' ? 'Checking the earlier correction. Its outcome is still uncertain.' : 'The bill amount and due date are saved. Its note still needs attention.', updatedAt: correction.updatedAt };
}

function snapshot(activity: FinancialActivity): CorrectionSnapshot {
  const correction = corrections.get(latest.get(key(activity.reference)) || '');
  const kept = correction?.effectiveResult as { resolution?: string; snapshot?: CorrectionSnapshot } | null;
  if (kept?.resolution === 'kept_actual' && kept.snapshot) return currentDemoFinanceSnapshot(kept.snapshot);
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
  const result = currentDemoFinanceSnapshot({ budgetId: 'demo-budget', transactions: evidence?.objects.filter(o => o.kind === 'transaction').map(o => ({ ...o.after, id: o.id })) || [],
    schedules: evidence?.objects.filter(o => o.kind === 'schedule').map(o => ({ ...o.after, id: o.id })) || [],
    rules: hasSchedule ? [{ id: ruleId, conditions: [{ field: 'amount', op: 'is', value: -9000 }, { field: 'account', op: 'is', value: 'demo-checking' }, { field: 'payee', op: 'is', value: payeeId }, { field: 'date', op: 'is', value: { frequency: 'monthly', interval: 1, patterns: [{ type: 'day', value: 15 }], start: getDemoSeed().dateKey } }], actions: [{ op: 'link-schedule', value: scheduleId }, { op: 'set', field: 'category', value: 'demo-utilities' }], tombstone: 0 }] : [], dates: hasSchedule ? [{ id: `${scheduleId}-date`, schedule_id: scheduleId, local_next_date: date, base_next_date: date, local_next_date_ts:0, base_next_date_ts:0 }] : [], accounts: clone(metadata.accounts), payees: [...clone(metadata.payees), ...metadata.accounts.filter(account => !metadata.payees.some(payee => 'transfer_acct' in payee && payee.transfer_acct === account.id)).map(account => ({ id: `demo-transfer-payee-${account.id}`, name: account.name, transfer_acct: account.id })), { id: payeeId, name: activity.payee || 'Fictional payee' }],
    categories: metadata.categories.flatMap(group => clone(group.categories)), scheduleNames: hasSchedule ? [{ id: scheduleId, name: String(schedule?.after?.name || 'Fictional Electric') }] : [] });
  const ledger = getDemoSeed().transactions;
  const linked = ledger.filter(row => row.scheduleId && result.schedules.some(schedule => schedule.id === row.scheduleId));
  const linkedIds = new Set(linked.flatMap(row => [row.id, ...(row.transferId ? [row.transferId] : [])]));
  for (const row of ledger.filter(row => linkedIds.has(row.id) && !result.transactions.some(current => current.id === row.id))) {
    result.transactions.push({ id: row.id, acct: row.accountId || metadata.accounts.find(account => account.name === row.account)?.id,
      description: row.payeeId || null, amount: Math.round(row.amount * 100) * (row.direction === 'income' ? 1 : -1), date: Number(row.date.replace(/-/g, '')),
      schedule: row.scheduleId || null, transferred_id: row.transferId || null, category: metadata.categories.flatMap(group => group.categories).find(category => category.name === row.category)?.id || null,
      notes: row.notes || '', cleared: !!row.cleared, reconciled: !!row.reconciled });
  }
  return currentDemoFinanceSnapshot(result);
}

function seedDemoRecovery(activity: FinancialActivity): void {
  const partial = activity.reference.id === 'demo-event-partial';
  if ((!partial && activity.reference.id !== 'demo-event-uncertain') || latest.has(key(activity.reference))) return;
  const current = snapshot(activity);
  const id = partial ? 'demo-correction-partial' : 'demo-correction-recovering';
  const revised = new Date(`${getDemoSeed().dateKey}T12:00:00Z`);
  revised.setUTCDate(revised.getUTCDate() + 14);
  const date = revised.toISOString().slice(0, 10);
  const schedule = current.schedules[0]!;
  const rule = current.rules[0]!;
  if (partial) {
    rule.conditions = (rule.conditions as Array<{ field: string; value: unknown }>).map(condition => condition.field === 'amount' ? { ...condition, value: -8200 } : condition.field === 'date' ? { ...condition, value: getDemoSeed().dateKey } : condition);
  }
  const old = rule.conditions as Array<{ field: string; value: unknown }>;
  const payeeId = String(old.find(condition => condition.field === 'payee')?.value || '');
  const draft: FinancialCorrectionDraft = { type: 'bill', amountCents: 9000, date, accountId: 'demo-checking', payeeId, targetScheduleId: schedule.id, name: activity.payee || 'Fictional bill', ...(partial ? { notes: 'Revised bill ELEC-2048.' } : {}) };
  const targets = { transactionIds: [], scheduleIds: current.schedules.map(row => row.id), ruleIds: current.rules.map(row => row.id) };
  const conditions = old.map(condition => condition.field === 'amount' ? { ...condition, value: -9000 } : condition.field === 'date' ? { ...condition, value: condition.value && typeof condition.value === 'object' ? { ...condition.value, start: date } : date } : condition);
  const step: CorrectionStep = { id: `${id}-step`, command: 'schedule/update', payload: { schedule: { id: schedule.id }, conditions }, before: clone(current), targets,
    after: { schedule: clone(schedule), conditions, scheduleActions: clone(rule.actions as unknown[]), nextDate: Number(date.replace(/-/g, '')) } };
  const observed = partial ? clone(current) : null;
  if (observed) {
    observed.rules[0] = { ...observed.rules[0]!, conditions: clone(conditions) };
    observed.dates[0] = { ...observed.dates[0]!, local_next_date: step.after.nextDate, base_next_date: step.after.nextDate };
  }
  const notesStep: CorrectionStep = { id: `${id}-notes`, command: 'schedule/rule-update', payload: {}, before: clone(current), targets,
    after: { ruleActions: { scheduleId: schedule.id, actions: [...clone(rule.actions as unknown[]), { op: 'set', field: 'notes', value: draft.notes }] } } };
  const preview: FinancialCorrectionPreview = { id, activityId: activity.id, reference: activity.reference, budgetId: 'demo-budget', sourceRevision: '1', predecessorId: null, draft,
    originalReceipts: clone(activity.originalReceipts), evidence: clone(activity.originalReceipts[0]!.evidence!), snapshot: clone(current), targets, steps: partial ? [step, notesStep] : [step], createdAt: activity.createdAt + 14 * 60_000 };
  const correction: FinancialCorrection = { id, preview, state: partial ? 'attention' : 'recovering', executionStopped: partial,
    steps: partial ? [
      { step, attemptedAt: activity.createdAt + 15 * 60_000, state: 'applied', observed: clone(observed), error: null },
      { step: notesStep, attemptedAt: activity.createdAt + 16 * 60_000, state: 'no_write', observed: clone(observed), error: 'Actual rejected the schedule rule update; the note was not saved.' },
    ] : [{ step, attemptedAt: activity.createdAt + 15 * 60_000, state: 'uncertain', observed: null, error: 'The attempted schedule change cannot yet be verified.' }],
    revision: 1, effectiveResult: null, updatedAt: activity.createdAt + 18 * 60_000 };
  if (observed) publishDemoFinanceSnapshot(current, observed);
  corrections.set(id, correction);
  latest.set(key(activity.reference), id);
}

export function handleDemoCorrection(url: URL, method: string, body: DemoRequestBody, all: FinancialActivity[]): unknown {
  if (method === 'GET') return clone(corrections.get(decodeURIComponent(url.pathname.split('/').slice(-1)[0]!)) || demoNotFound(url.pathname));
  if (url.pathname.endsWith('/keep-confirm')) {
    const preview = keepPreviews.get(String(body.previewId));
    if (!preview) return demoNotFound(url.pathname);
    const correction = corrections.get(preview.correctionId);
    const accepted = correction?.effectiveResult as { keepPreviewId?: string } | null;
    if (accepted?.keepPreviewId === preview.id) return clone(correction);
    if (!correction || latest.get(key(preview.reference)) !== correction.id || correction.revision !== preview.correctionRevision || correction.preview.sourceRevision !== preview.sourceRevision) constraint('This correction changed. Refresh the current result before keeping it.');
    if (correction.state !== 'attention' || !correction.executionStopped) constraint('The earlier attempt has not stopped. Wait for recovery before keeping its result.');
    if (JSON.stringify(currentDemoFinanceSnapshot(preview.snapshot)) !== JSON.stringify(preview.snapshot)) constraint('Actual changed after this preview. Review the current result again.');
    const keptAt = Date.now();
    correction.effectiveResult = { ...buildKeptFinancialResult(correction.preview, preview.snapshot), keepPreviewId: preview.id, keptAt };
    correction.state = 'completed';
    correction.revision += 1;
    correction.updatedAt = keptAt;
    announceDemoFinanceChange();
    return clone(correction);
  }
  if (url.pathname.endsWith('/confirm')) {
    const preview = previews.get(String(body.previewId));
    if (!preview) return demoNotFound(url.pathname);
    const existing = corrections.get(preview.id);
    if (existing) return clone(existing);
    const current = latest.get(key(preview.reference)) || null;
    if (current !== preview.predecessorId || JSON.stringify(currentDemoFinanceSnapshot(preview.snapshot)) !== JSON.stringify(preview.snapshot)) constraint('This record changed after preview. Refresh the preview before saving.');
    const observed = clone(preview.snapshot);
    const observations: CorrectionSnapshot[] = [];
    for (const step of preview.steps) {
      if (step.after.transactions) observed.transactions = clone(step.after.transactions);
      if (step.after.schedule) observed.schedules = [clone(step.after.schedule)];
      if (step.after.conditions) observed.rules = [{ ...observed.rules[0], id: String(step.after.schedule?.rule || 'demo-schedule-rule'), conditions: clone(step.after.conditions), actions: clone(step.after.scheduleActions || []) }];
      if (step.after.nextDate) observed.dates = [{ id: `${observed.schedules[0]?.id}-date`, schedule_id: observed.schedules[0]?.id, base_next_date: step.after.nextDate, local_next_date: step.after.nextDate, local_next_date_ts:0, base_next_date_ts:0 }];
      if (step.after.removedScheduleId) { observed.schedules = []; observed.rules = []; observed.dates = []; }
      if (step.after.ruleActions) {
        const ruleId = observed.schedules.find(row => row.id === step.after.ruleActions!.scheduleId)?.rule;
        observed.rules = observed.rules.map(row => row.id === ruleId ? { ...row, actions: clone(step.after.ruleActions!.actions) } : row);
      }
      observations.push(clone(observed));
    }
    const writtenTransactions = observed.transactions.filter(row => preview.steps.some(step => step.after.transactions?.some(written => written.id === row.id)));
    const correction: FinancialCorrection = { id: preview.id, preview: clone(preview), state: 'completed', executionStopped: true,
      steps: preview.steps.map((step, index) => ({ step: clone(step), attemptedAt: Date.now(), state: 'applied', observed: observations[index]!, error: null })),
      revision: 1, effectiveResult: { outcome: 'updated', correctionId: preview.id, entry: { ...clone(preview.draft), payee: preview.draft.type === 'transfer_schedule' ? undefined : observed.payees.find(payee => payee.id === preview.draft.payeeId)?.name || preview.draft.name || all.find(activity => key(activity.reference) === key(preview.reference))?.payee || 'Fictional payee', kind: preview.draft.type === 'payment' ? 'expense' : preview.draft.type, amount: preview.draft.amountCents / 100 }, evidence: { budgetId: 'demo-budget', objects: [...writtenTransactions.map((row, index) => ({ kind: 'transaction', id: row.id, role: index === 0 ? 'primary' : 'counterpart', provenance: 'updated', beforeState: 'captured', before: preview.snapshot.transactions.find(before => before.id === row.id) || null, after: row })), ...observed.schedules.map(row => ({ kind: 'schedule', id: row.id, role: 'primary', provenance: preview.evidence.objects.find(object => object.kind === 'schedule' && object.id === row.id)?.provenance || 'created', beforeState: preview.evidence.objects.find(object => object.kind === 'schedule' && object.id === row.id)?.beforeState || 'confirmed_absent', before: preview.evidence.objects.find(object => object.kind === 'schedule' && object.id === row.id)?.before || null, after: row }))] }, transactionId: writtenTransactions[0]?.id, scheduleId: observed.schedules[0]?.id }, updatedAt: Date.now() };
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
  if (url.pathname.endsWith('/keep-preview')) {
    const correction = predecessorId ? corrections.get(predecessorId) : null;
    if (!correction || correction.id !== body.correctionId) constraint('The correction changed. Refresh this record before keeping it.');
    if (correction.state !== 'attention' || !correction.executionStopped) constraint('The earlier attempt has not stopped. Wait for recovery before keeping its result.');
    const preview: FinancialCorrectionKeepPreview = { id: createClientId(), correctionId: correction.id, correctionRevision: correction.revision,
      reference: clone(reference), sourceRevision: correction.preview.sourceRevision, snapshot: clone(current), targets: clone(correction.preview.targets), reviewedAt: Date.now() };
    keepPreviews.set(preview.id, preview);
    return clone(preview);
  }
  if (url.pathname.endsWith('/recheck')) {
    const correction = predecessorId ? corrections.get(predecessorId) : null;
    if (!correction || correction.id !== body.correctionId) constraint('The correction changed. Refresh this record before rechecking.');
    if (correction.state !== 'completed' && (correction.state !== 'attention' || !correction.executionStopped)) constraint('The earlier attempt has not stopped. Wait for recovery before resolving it.');
    // Demo has no external Actual editor: a stopped seed keeps its observed partial state.
    return clone({ reference, activityId:activity.id, budgetId:'demo-budget', evidence,
      snapshot:current, originalReceipts:activity.originalReceipts, correction });
  }
  if (url.pathname.endsWith('/inspect')) return clone({ reference, activityId: activity.id, budgetId: 'demo-budget', evidence,
    snapshot: current, originalReceipts: activity.originalReceipts, correction: predecessorId ? corrections.get(predecessorId) : null });
  const previous = predecessorId ? corrections.get(predecessorId) : null;
  if (previous && previous.state !== 'completed' && (!previous.executionStopped || previous.steps.some(step => step.attemptedAt !== null && !['applied', 'no_write', 'partial'].includes(step.state)))) constraint('The earlier attempted change remains uncertain. Wait for recovery before starting another correction.');
  if (!activity.actions.correct) constraint('This record is not available for correction.');
  const draft = body.draft as FinancialCorrectionDraft;
  if (!draft || !Number.isInteger(draft.amountCents) || draft.amountCents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) constraint('Enter a positive amount and valid date.');
  if (draft.type === 'transfer' || draft.type === 'transfer_schedule' ? !draft.fromAccountId || !draft.toAccountId || draft.fromAccountId === draft.toAccountId : !draft.accountId) constraint('Choose the accounts for this record.');
  if (current.schedules.length && draft.type !== 'bill' && draft.type !== 'transfer_schedule' && !draft.scheduleTreatment) constraint('Choose what happens to the existing schedule.');
  if (draft.scheduleTreatment === 'retire' && evidence.objects.some(object => object.kind === 'schedule' && object.provenance !== 'created')) constraint('This existing schedule was updated by the original operation. Its creation is not proven, so it cannot be retired here. Keep it or amend the current schedule.');
  if (draft.scheduleTreatment === 'restore') constraint('The original schedule snapshot is unavailable. Keep the current schedule or retire it explicitly.');
  const id = `demo-correction-${previews.size + 1}`;
  const targets = { transactionIds: current.transactions.map(row => row.id), scheduleIds: current.schedules.map(row => row.id), ruleIds: current.rules.map(row => row.id) };
  const steps: CorrectionStep[] = [];
  if (draft.targetScheduleId && draft.targetScheduleId !== current.schedules[0]?.id) constraint('Only the exact bound schedule can be edited.');
  if (draft.type !== 'transfer' && draft.type !== 'bill' && draft.type !== 'transfer_schedule' && current.transactions.length > 1 && !draft.retainTransactionId) constraint('Choose the transfer entry to retain.');
  if (draft.type === 'transfer_schedule') {
    if (draft.accountId !== undefined || draft.payeeId !== undefined || draft.categoryId !== undefined || draft.scheduleTreatment !== undefined) constraint('Use the transfer accounts to edit this schedule.');
    const primary = evidence.objects.filter(object => object.role === 'primary' && ['schedule', 'transaction'].includes(object.kind));
    const bound = primary.length === 1 && primary[0]?.kind === 'schedule' && (!draft.targetScheduleId || primary[0].id === draft.targetScheduleId) ? primary[0] : undefined;
    const schedule = current.schedules.find(row => row.id === bound?.id && !row.tombstone);
    const rule = current.rules.find(row => row.id === schedule?.rule && !row.tombstone);
    if (!schedule || !rule) constraint('Choose the exact existing transfer schedule; this edit cannot convert a transaction or create another schedule.');
    const old = (rule.conditions || []) as Array<{ field: string; op: string; value: unknown }>;
    const field = (name: string) => old.find(condition => condition.field === name)?.value;
    if (['amount', 'account', 'payee', 'date'].some(name => old.filter(condition => condition.field === name).length !== 1) || old.some(condition => condition.op !== 'is')) constraint('The transfer schedule conditions are not supported.');
    const amount = Number(field('amount'));
    const originalPayee = current.payees.find(payee => payee.id === field('payee') && !payee.tombstone);
    if (!Number.isSafeInteger(amount) || !amount || !originalPayee?.transfer_acct || originalPayee.transfer_acct === field('account')) constraint('The saved schedule is not an intact transfer.');
    for (const accountId of [draft.fromAccountId, draft.toAccountId]) if (!current.accounts.some(account => account.id === accountId && !account.closed && !account.tombstone)) constraint('Choose open accounts for this transfer.');
    if (draft.date <= getDemoSeed().dateKey) constraint('Choose a future date for the transfer schedule.');
    const transferAccount = amount > 0 ? draft.fromAccountId : draft.toAccountId;
    const payees = current.payees.filter(payee => payee.transfer_acct === transferAccount && !payee.tombstone);
    if (payees.length !== 1) constraint('The transfer account does not have a unique Actual transfer payee.');
    const recurrence = field('date');
    const next = current.dates.find(row => row.schedule_id === schedule.id && !row.tombstone);
    const currentDate = String(next?.local_next_date_ts === next?.base_next_date_ts ? next?.local_next_date : next?.base_next_date);
    const nextDate = Number(draft.date.replace(/-/g, ''));
    let dateValue: unknown = draft.date;
    if (recurrence && typeof recurrence === 'object') {
      const value = recurrence as Record<string, unknown>;
      dateValue = Number(value.interval || 1) > 1 ? value : { ...value, start: draft.date };
      if (value.skipWeekend && [0, 6].includes(new Date(`${draft.date}T00:00:00Z`).getUTCDay())) constraint('This schedule moves weekend occurrences; choose its effective weekday date.');
      if ((dateValue as Record<string, unknown>).start !== draft.date && currentDate !== String(nextDate)) constraint('This recurrence interval does not support moving the occurrence date.');
    }
    const changes: Record<string, unknown> = { amount: amount > 0 ? draft.amountCents : -draft.amountCents, account: amount > 0 ? draft.toAccountId : draft.fromAccountId, payee: payees[0]!.id, date: dateValue };
    const conditions = old.map(condition => Object.prototype.hasOwnProperty.call(changes, condition.field) ? { ...condition, value: changes[condition.field] } : condition);
    const actions = ((rule.actions || []) as Array<Record<string, unknown>>).map(action => {
      const options = action.options as Record<string, unknown> | undefined;
      if (action.op === 'set' && action.field === 'amount' && !options?.template && !options?.formula) return { ...action, value: changes.amount };
      if (action.op === 'set' && action.field === 'notes' && draft.notes !== undefined) return { ...action, value: draft.notes };
      return action;
    });
    if (draft.notes !== undefined && !actions.some(action => action.op === 'set' && action.field === 'notes')) actions.push({ op: 'set', field: 'notes', value: draft.notes });
    steps.push({ id: `${id}-schedule-step`, command: 'schedule/update', payload: {}, targets, before: current, after: { schedule: { ...schedule, ...(draft.name !== undefined ? { name: draft.name } : {}) }, conditions, scheduleActions: actions, nextDate } });
  } else if (draft.type === 'bill') {
    if (current.transactions.length) steps.push({ id: `${id}-remove-ledger`, command: 'transactions-batch-update', payload: {}, targets, before: current, after: { transactions: [] } });
    const schedule = { id: current.schedules[0]?.id || `${id}-schedule`, name: draft.name || activity.payee || 'Bill', rule: current.schedules[0]?.rule || `${id}-rule`, tombstone: 0 };
    const conditions = [{ field: 'amount', op: 'is', value: -draft.amountCents }, { field: 'account', op: 'is', value: draft.accountId }, { field: 'payee', op: 'is', value: draft.payeeId || null }, { field: 'date', op: 'is', value: (current.rules[0]?.conditions as Array<{ field: string; value: unknown }> | undefined)?.find(condition => condition.field === 'date')?.value || draft.date }];
    const scheduleActions = clone((current.rules[0]?.actions || [{ op: 'link-schedule', value: schedule.id }]) as Array<Record<string, unknown>>);
    steps.push({ id: `${id}-schedule-step`, command: current.schedules.length ? 'schedule/update' : 'schedule/create', payload: {}, targets, before: current, after: { schedule, conditions, scheduleActions, nextDate: Number(draft.date.replace(/-/g, '')) } });
    if (draft.categoryId !== undefined || draft.notes !== undefined) {
      const replacements = [{ field: 'category', value: draft.categoryId }, { field: 'notes', value: draft.notes }].filter(change => change.value !== undefined);
      const actions = [...scheduleActions.filter(action => !(action.op === 'set' && replacements.some(change => change.field === action.field))), ...replacements.map(change => ({ op: 'set', ...change }))];
      steps.push({ id: `${id}-schedule-notes`, command: 'schedule/rule-update', payload: {}, targets, before: current, after: { ruleActions: { scheduleId: schedule.id, actions } } });
    }
  } else {
    const retained = current.transactions.find(row => row.id === draft.retainTransactionId) || current.transactions[0];
    const counterpartId = current.transactions.find(row => row.id !== retained?.id)?.id || `${id}-counterpart`;
    const primary = { ...retained, schedule: draft.type === 'payment' && draft.scheduleTreatment === 'keep' ? current.schedules[0]?.id || retained?.schedule : retained?.schedule, id: retained?.id || `${id}-transaction`, amount: draft.type === 'income' ? draft.amountCents : -draft.amountCents, date: Number(draft.date.replace(/-/g, '')), acct: draft.type === 'transfer' ? draft.fromAccountId : draft.accountId, description: draft.payeeId || null, category: draft.type === 'transfer' ? null : draft.categoryId || null, notes: draft.notes || '', transferred_id: null };
    const transactions = draft.type === 'transfer' ? [{ ...primary, transferred_id: counterpartId }, { ...primary, id: counterpartId, amount: draft.amountCents, acct: draft.toAccountId, transferred_id: primary.id }] : [primary];
    steps.push({ id: `${id}-ledger`, command: 'transactions-batch-update', payload: {}, targets, before: current, after: { transactions } });
    if (draft.scheduleTreatment === 'retire' && current.schedules[0]) steps.push({ id: `${id}-retire`, command: 'schedule/delete', payload: {}, targets, before: current, after: { removedScheduleId: current.schedules[0].id } });
  }
  const preview: FinancialCorrectionPreview = { id, reference, activityId: activity.id, budgetId: 'demo-budget', sourceRevision: predecessorId || '1', predecessorId, draft: clone(draft), originalReceipts: clone(activity.originalReceipts), evidence: clone(evidence), snapshot: current, targets, steps, createdAt: Date.now() };
  previews.set(id, preview);
  return clone(preview);
}
