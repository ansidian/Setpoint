import type { FinancialActivity } from '../../../shared/types/financial-activity';
import type { CorrectionRow, CorrectionSnapshot, CorrectionStep, FinancialCorrection, FinancialCorrectionDraft, FinancialCorrectionInspection } from '../../../shared/types/financial-corrections';

export const typeLabels = { payment: 'One-time payment', income: 'Income', transfer: 'Transfer', bill: 'Schedule / bill' };
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function rows(value: unknown): Array<Record<string, unknown>> {
  if (typeof value === 'string') { try { return rows(JSON.parse(value)); } catch { return []; } }
  return Array.isArray(value) ? value.map(record) : [];
}
export function dateLabel(value: unknown): string {
  const text = String(value || '');
  return /^\d{8}$/.test(text) ? `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}` : text.slice(0,10);
}
export function money(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(value / 100) : 'Not captured';
}
export function nameFor(items: CorrectionRow[], id: unknown): string {
  if (!id) return 'None';
  return String(items.find(item => item.id === id)?.name || 'Unavailable target');
}
export function normalizedField(field: unknown): string {
  return ({ acct:'account', description:'payee' } as Record<string,string>)[String(field)] || String(field);
}
export function scheduleRule(snapshot: CorrectionSnapshot, scheduleId?: string): CorrectionRow | undefined {
  const schedule = snapshot.schedules.find(row => !row.tombstone && (!scheduleId || row.id === scheduleId));
  return snapshot.rules.find(row => !row.tombstone && row.id === schedule?.rule);
}
export function nextOccurrence(snapshot: CorrectionSnapshot, scheduleId: string): unknown {
  const next = snapshot.dates.find(row => !row.tombstone && row.schedule_id === scheduleId);
  if (!next) return undefined;
  return next.local_next_date_ts === next.base_next_date_ts ? next.local_next_date : next.base_next_date;
}
export function conditionValue(snapshot: CorrectionSnapshot, field: string, scheduleId?: string): unknown {
  return rows(scheduleRule(snapshot,scheduleId)?.conditions).find(condition => normalizedField(condition.field) === normalizedField(field))?.value;
}
export function initialDraft(inspection: FinancialCorrectionInspection, activity: FinancialActivity): FinancialCorrectionDraft {
  if (inspection.correction?.state === 'attention') return structuredClone(inspection.correction.preview.draft);
  const snapshot = inspection.snapshot;
  const primaryEvidence = inspection.evidence.objects.find(object => object.role === 'primary' && ['transaction','schedule'].includes(object.kind));
  const primary = primaryEvidence?.kind === 'transaction' ? snapshot.transactions.find(row => row.id === primaryEvidence.id && !row.tombstone) : undefined;
  const counterpart = primary?.transferred_id ? snapshot.transactions.find(row => row.id === primary.transferred_id && !row.tombstone) : undefined;
  const schedule = primaryEvidence?.kind === 'schedule' ? snapshot.schedules.find(row => row.id === primaryEvidence.id && !row.tombstone)
    : snapshot.schedules.find(row => row.id === primary?.schedule && !row.tombstone);
  const actions = rows(scheduleRule(snapshot,schedule?.id)?.actions);
  const categoryAction = actions.find(action => action.op === 'set' && action.field === 'category');
  const notesAction = actions.find(action => action.op === 'set' && action.field === 'notes');
  const negative = counterpart ? Number(primary?.amount) < 0 ? primary : counterpart : undefined;
  const positive = counterpart ? Number(primary?.amount) >= 0 ? primary : counterpart : undefined;
  const dateCondition = conditionValue(snapshot,'date',schedule?.id);
  const amount = Number(primary?.amount ?? conditionValue(snapshot,'amount',schedule?.id) ?? activity.amountCents ?? 0);
  return { type: primary ? counterpart ? 'transfer' : Number(primary.amount) > 0 ? 'income' : 'payment' : 'bill',
    amountCents: Number.isSafeInteger(amount) ? Math.abs(amount) : 0,
    date: dateLabel(primary?.date ?? (schedule ? nextOccurrence(snapshot,schedule.id) : undefined) ?? (typeof dateCondition === 'object' ? record(dateCondition).start : dateCondition)),
    accountId: String(primary?.acct ?? conditionValue(snapshot,'account',schedule?.id) ?? ''),
    fromAccountId: String(negative?.acct || ''), toAccountId: String(positive?.acct || ''),
    payeeId: counterpart ? null : String(primary?.description ?? conditionValue(snapshot,'payee',schedule?.id) ?? '') || null,
    categoryId: primary ? primary.category == null ? null : String(primary.category) : categoryAction ? String(categoryAction.value || '') || null : undefined,
    notes: primary ? String(primary.notes || '') : notesAction ? String(notesAction.value || '') : undefined,
    name: String(schedule?.name || activity.payee || ''),
    ...(schedule ? { targetScheduleId:schedule.id } : {}),
  };
}
/** Omission preserves existing values; null is an explicit clearing instruction. */
export function intendedDraft(draft: FinancialCorrectionDraft): FinancialCorrectionDraft {
  const common = { type:draft.type, amountCents:draft.amountCents, date:draft.date, notes:draft.notes, categoryId:draft.categoryId,
    ...(draft.scheduleTreatment && draft.type !== 'bill' ? { scheduleTreatment:draft.scheduleTreatment } : {}),
    ...(draft.retainTransactionId && draft.type !== 'transfer' && draft.type !== 'bill' ? { retainTransactionId:draft.retainTransactionId } : {}) };
  return draft.type === 'transfer' ? { ...common, fromAccountId:draft.fromAccountId, toAccountId:draft.toAccountId }
    : { ...common, accountId:draft.accountId, payeeId:draft.payeeId,
      ...(draft.type === 'bill' ? { name:draft.name, ...(draft.targetScheduleId ? { targetScheduleId:draft.targetScheduleId } : {}) } : {}) };
}
/** Eligibility is only an invitation to ask the facade; the server decides exact successor safety. */
export function mayRequestSuccessor(correction: FinancialCorrection): boolean {
  return correction.state === 'attention' && correction.executionStopped && correction.steps.every(step => step.attemptedAt === null || ['applied','partial','no_write'].includes(step.state));
}
/** Project only frozen, intended effects for sequential preview labels, never as observed Actual state. */
export function afterStep(before: CorrectionSnapshot, step: CorrectionStep): CorrectionSnapshot {
  const snapshot = structuredClone(before);
  for (const patch of step.after.transactions || []) {
    const index = snapshot.transactions.findIndex(row => row.id === patch.id);
    if (index < 0) snapshot.transactions.push(patch); else snapshot.transactions[index] = { ...snapshot.transactions[index], ...patch };
  }
  if (step.after.schedule) {
    const patch = step.after.schedule;
    const index = snapshot.schedules.findIndex(row => row.id === patch.id);
    const ruleId = String(patch.rule || snapshot.schedules[index]?.rule || `preview-${patch.id}`);
    const updated = { ...snapshot.schedules[index], ...patch, rule:ruleId };
    if (index < 0) snapshot.schedules.push(updated); else snapshot.schedules[index] = updated;
    let rule = snapshot.rules.find(row => row.id === ruleId);
    if (!rule) { rule = { id:ruleId }; snapshot.rules.push(rule); }
    if (step.after.conditions) rule.conditions = step.after.conditions;
    if (step.after.scheduleActions) rule.actions = step.after.scheduleActions;
    if (step.after.nextDate !== undefined) snapshot.dates = [...snapshot.dates.filter(row => row.schedule_id !== patch.id),
      { id:`preview-${patch.id}`, schedule_id:patch.id, local_next_date:step.after.nextDate, base_next_date:step.after.nextDate, local_next_date_ts:0, base_next_date_ts:0 }];
  }
  if (step.after.ruleActions) {
    const rule = scheduleRule(snapshot,step.after.ruleActions.scheduleId);
    if (rule) rule.actions = step.after.ruleActions.actions;
  }
  if (step.after.removedScheduleId) {
    const schedule = snapshot.schedules.find(row => row.id === step.after.removedScheduleId);
    if (schedule) schedule.tombstone = 1;
  }
  if (step.after.removedRuleId) {
    const rule = snapshot.rules.find(row => row.id === step.after.removedRuleId);
    if (rule) rule.tombstone = 1;
  }
  return snapshot;
}
