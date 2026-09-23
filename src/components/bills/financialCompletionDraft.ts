import { positiveUsdCents } from '../../../shared/financial-splits';
import type { FinancialEmailPlan } from '../../../shared/types/bills';
import type { FinancialEventCompletionEntry } from '../../../shared/types/financial-operations';

type EntryKind = FinancialEventCompletionEntry['kind'];
export interface FinancialCompletionFields {
  splits: Array<{ amount: string; categoryId: string; notes: string }>;
  kind: EntryKind | '';
  amount: string;
  date: string;
  payee: string;
  accountId: string;
  fromAccountId: string;
  toAccountId: string;
  categoryId: string;
  scheduleName: string | null;
  notes: string;
}

function initialKind(plan: FinancialEmailPlan): FinancialCompletionFields['kind'] {
  if (plan.operation.intended === 'create_transfer') return 'transfer';
  if (plan.operation.intended === 'create_transfer_schedule') return 'transfer_schedule';
  if (plan.operation.intended === 'create_schedule') return 'bill';
  if (plan.candidate.type === 'transfer') {
    if (['card_payment_completed', 'account_transfer_completed'].includes(String(plan.candidate.event_kind))) return 'transfer';
    return ['statement_issued', 'payment_scheduled'].includes(String(plan.candidate.event_kind)) ? 'transfer_schedule' : '';
  }
  return ['expense', 'income', 'bill'].includes(String(plan.candidate.type)) ? plan.candidate.type as EntryKind : '';
}

function prefill(plan: FinancialEmailPlan): FinancialCompletionFields {
  const resolved = (key: keyof FinancialEmailPlan['targets']) => plan.targets[key].status === 'resolved' ? plan.targets[key] : null;
  const orderTotal = plan.candidate.order_items?.reduce((sum, order) => sum + Math.round(order.amount * 100), 0);
  return {
    splits: plan.workflow?.completion?.splits?.map(split => ({ amount: String(split.amount), categoryId: split.categoryId || '', notes: split.notes || '' })) || plan.candidate.order_items?.map(order => ({ amount: String(order.amount), categoryId: '', notes: `Order # ${order.reference}` })) || [],
    kind: initialKind(plan), amount: plan.candidate.amount == null ? orderTotal ? (orderTotal / 100).toFixed(2) : '' : String(plan.candidate.amount),
    date: plan.candidate.due_date || '', payee: resolved('payee')?.label || plan.candidate.payee || plan.candidate.payee_hint || '',
    accountId: resolved('account')?.id || '', fromAccountId: resolved('fromAccount')?.id || '',
    toAccountId: resolved('toAccount')?.id || '', categoryId: resolved('category')?.id || '',
    scheduleName: resolved('schedule')?.label || null, notes: plan.candidate.notes || '',
  };
}

export function completionAmount(fields: FinancialCompletionFields): number | null {
  return positiveUsdCents(Number(fields.amount));
}

function splitCents(fields: FinancialCompletionFields): Array<number | null> {
  return fields.splits.map(split => split.amount.trim() === '' || Number(split.amount) === 0 ? 0 : positiveUsdCents(Number(split.amount)));
}

export function completionSplitBalance(fields: FinancialCompletionFields): number | null {
  const total = completionAmount(fields);
  const cents = splitCents(fields);
  if (total === null || cents.some(amount => amount === null)) return null;
  const assigned = cents.reduce<number>((sum, amount) => sum + amount!, 0);
  return Number.isSafeInteger(assigned) ? total - assigned : null;
}

/** Add the remainder in integer cents, assigning spare cents from the first row. */
export function distributeRemainingSplits(fields: FinancialCompletionFields): FinancialCompletionFields['splits'] | null {
  const remaining = completionSplitBalance(fields);
  const count = fields.splits.length;
  if (remaining === null || remaining <= 0 || count < 2 || count > 30) return null;
  const cents = splitCents(fields);
  const each = Math.floor(remaining / count);
  const spare = remaining % count;
  const amounts = cents.map((amount, index) => amount! + each + (index < spare ? 1 : 0));
  if (amounts.some(amount => amount <= 0)) return null;
  return fields.splits.map((split, index) => ({ ...split, amount: (amounts[index]! / 100).toFixed(2) }));
}

export function completionValues(fields: FinancialCompletionFields): string {
  const { kind, amount, date, notes, splits, fromAccountId, toAccountId, accountId, payee, categoryId, scheduleName } = fields;
  const transfer = kind === 'transfer' || kind === 'transfer_schedule';
  return JSON.stringify([kind, amount === '' ? '' : Number(amount), date, notes,
    ...(transfer ? [fromAccountId, toAccountId] : [accountId, payee.trim(), kind === 'expense' && splits.length ? splits : categoryId]),
    ...(['bill', 'transfer_schedule'].includes(kind) ? [scheduleName?.trim() ?? null] : [])]);
}

export function createCompletionDraft(plan: FinancialEmailPlan) {
  const fields = prefill(plan);
  return { fields, baseline: fields, touched: {} as Partial<Record<keyof FinancialCompletionFields, boolean>>,
    revision: plan.workflow!.completion! };
}
export type FinancialCompletionDraft = ReturnType<typeof createCompletionDraft>;

export function editCompletionDraft<K extends keyof FinancialCompletionFields>(draft: FinancialCompletionDraft, key: K, value: FinancialCompletionFields[K]): FinancialCompletionDraft {
  return { ...draft, fields: { ...draft.fields, [key]: value }, touched: { ...draft.touched, [key]: true } };
}

/** Enrichment may fill known fields; it never authorizes a different source revision. */
export function enrichCompletionDraft(draft: FinancialCompletionDraft, plan: FinancialEmailPlan): FinancialCompletionDraft {
  const next = plan.workflow?.completion;
  if (!next || next.emailUid !== draft.revision.emailUid || next.documentRevision !== draft.revision.documentRevision
    || next.eventRevision !== draft.revision.eventRevision) return draft;
  const incoming = prefill(plan);
  const fields = { ...draft.fields };
  const baseline = { ...draft.baseline };
  let changed = false;
  for (const key of Object.keys(incoming) as Array<keyof FinancialCompletionFields>) {
    if (draft.touched[key] || !incoming[key] || JSON.stringify(incoming[key]) === JSON.stringify(fields[key])) continue;
    // A different owner-selected operation must not receive targets for the old operation.
    if (draft.touched.kind && draft.fields.kind !== incoming.kind) continue;
    Object.assign(fields, { [key]: incoming[key] });
    Object.assign(baseline, { [key]: incoming[key] });
    changed = true;
  }
  return changed ? { ...draft, fields, baseline } : draft;
}
