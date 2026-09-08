import type { FinancialObjectEvidence, FinancialWriteEvidence } from './types/financial-activity.ts';
import type { CorrectionRow, CorrectionSnapshot, FinancialCorrectionDraft, FinancialCorrectionPreview } from './types/financial-corrections.ts';

interface ObservedEntry {
  type: FinancialCorrectionDraft['type'];
  kind: 'expense' | 'income' | 'transfer' | 'bill' | 'transfer_schedule';
  amountCents: number;
  signedAmountCents: number;
  amount: number;
  date: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  payeeId?: string | null;
  payee?: string;
  categoryId?: string | null;
  notes?: string;
  name?: string;
  scheduleId?: string;
  scheduleName?: string;
}
const active = (row: CorrectionRow) => !row.tombstone;
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
function dateString(value: unknown): string | undefined {
  const raw = typeof value === 'number' ? String(value) : text(value);
  const date = raw?.match(/^\d{8}$/) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : raw;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}
function list(value: unknown): Record<string, unknown>[] | undefined {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) && parsed.every(row => row && typeof row === 'object' && !Array.isArray(row)) ? parsed : undefined;
  } catch { return undefined; }
}
function transactionEntry(row: CorrectionRow, snapshot: CorrectionSnapshot): ObservedEntry | undefined {
  const amount = row.amount, date = dateString(row.date), accountId = text(row.acct);
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || !date || !accountId || row.isParent || row.isChild
    || snapshot.transactions.some(child => active(child) && child.parent_id === row.id)
    || !snapshot.accounts.some(account => account.id === accountId && active(account))) return undefined;
  const payee = snapshot.payees.find(payee => payee.id === row.description && active(payee));
  const common = { amountCents: Math.abs(amount), signedAmountCents: amount, amount: Math.abs(amount) / 100, date,
    categoryId: row.category === null ? null : text(row.category), notes: text(row.notes) };
  if (row.transferred_id) {
    const peer = snapshot.transactions.find(peer => peer.id === row.transferred_id && active(peer));
    const peerPayee = snapshot.payees.find(payee => payee.id === peer?.description && active(payee));
    if (!peer || peer.transferred_id !== row.id || peer.amount !== -amount || amount === 0 || peer.acct === accountId
      || dateString(peer.date) !== date || peer.isParent || peer.isChild || payee?.transfer_acct !== peer.acct || peerPayee?.transfer_acct !== accountId
      || !snapshot.accounts.some(account => account.id === peer.acct && active(account))) return undefined;
    return { ...common, type: 'transfer', kind: 'transfer', fromAccountId: amount < 0 ? accountId : text(peer.acct), toAccountId: amount > 0 ? accountId : text(peer.acct) };
  }
  if (payee?.transfer_acct) return undefined;
  return { ...common, type: amount > 0 ? 'income' : 'payment', kind: amount > 0 ? 'income' : 'expense', accountId,
    payeeId: row.description === null ? null : text(row.description), payee: text(payee?.name) };
}
function scheduleEntry(row: CorrectionRow, snapshot: CorrectionSnapshot): ObservedEntry | undefined {
  const rule = snapshot.rules.find(rule => rule.id === row.rule && active(rule));
  const conditions: Record<string, unknown>[] | undefined = list(rule?.conditions)?.map(condition => ({ ...condition, field: ({ acct: 'account', description: 'payee' } as Record<string, string>)[String(condition.field)] || condition.field }));
  const actions = list(rule?.actions);
  const dates = snapshot.dates.filter(date => date.schedule_id === row.id && active(date));
  if (!conditions || !actions || dates.length !== 1 || conditions.filter(condition => condition.field === 'payee').length > 1 || actions.filter(action => action.op === 'link-schedule').length !== 1
    || !actions.some(action => action.op === 'link-schedule' && action.value === row.id)) return undefined;
  const field = (name: string) => { const found = conditions.filter(condition => condition.field === name); return found.length === 1 ? found[0] : undefined; };
  const amountCondition = field('amount'), accountCondition = field('account'), payeeCondition = field('payee');
  const amount = amountCondition?.value, accountId = text(accountCondition?.value);
  const next = dates[0]!;
  const date = dateString(next.local_next_date_ts === next.base_next_date_ts ? next.local_next_date : next.base_next_date);
  if (amountCondition?.op !== 'is' || typeof amount !== 'number' || !Number.isSafeInteger(amount) || !amount || accountCondition?.op !== 'is'
    || !date || !accountId || !field('date') || !snapshot.accounts.some(account => account.id === accountId && active(account))) return undefined;
  // Conflicting/dynamic rule overrides cannot be summarized as the condition's amount or accounts.
  if (actions.some(action => action.op === 'set' && ['amount', 'account', 'payee', 'date'].includes(String(action.field))
    && (action.value !== field(String(action.field))?.value || !!action.options && Object.values(action.options as object).some(Boolean)))) return undefined;
  const literalAction = (name: string) => { const found = actions.filter(action => action.op === 'set' && action.field === name); return found.length === 1 && (!found[0]!.options || !Object.values(found[0]!.options as object).some(Boolean)) ? found[0]!.value : undefined; };
  const payee = snapshot.payees.find(payee => payee.id === payeeCondition?.value && active(payee));
  const common = { amountCents: Math.abs(amount), signedAmountCents: amount, amount: Math.abs(amount) / 100, date, scheduleId: row.id,
    name: text(row.name), scheduleName: text(row.name), notes: text(literalAction('notes')), categoryId: text(literalAction('category')) };
  if (payee?.transfer_acct) {
    const opposite = text(payee.transfer_acct);
    if (payeeCondition?.op !== 'is' || !opposite || opposite === accountId || !snapshot.accounts.some(account => account.id === opposite && active(account))) return undefined;
    return { ...common, type: 'transfer_schedule', kind: 'transfer_schedule', fromAccountId: amount < 0 ? accountId : opposite, toAccountId: amount > 0 ? accountId : opposite };
  }
  if (amount > 0 || payeeCondition && payeeCondition.op !== 'is') return undefined;
  return { ...common, type: 'bill', kind: 'bill', accountId, payeeId: payeeCondition?.value === null ? null : text(payeeCondition?.value), payee: text(payee?.name) };
}

/** Accepts the observed graph without claiming that an interrupted draft reached Actual. */
export function buildKeptFinancialResult(preview: FinancialCorrectionPreview, snapshot: CorrectionSnapshot) {
  const original = preview.evidence.objects.filter(object => object.role === 'primary' && (object.kind === 'transaction' || object.kind === 'schedule'));
  let primary = original.length === 1 ? original[0] : undefined;
  const rows = (kind: FinancialObjectEvidence['kind']) => kind === 'transaction' ? snapshot.transactions : kind === 'schedule' ? snapshot.schedules : kind === 'rule' ? snapshot.rules : snapshot.dates;
  let current = primary && rows(primary.kind).find(row => row.id === primary!.id && active(row));
  if (!current) {
    const intended = new Map<string, { kind: 'transaction' | 'schedule'; row: CorrectionRow }>();
    for (const step of preview.steps) {
      for (const expected of step.after.transactions || []) if (!expected.tombstone) {
        const row = snapshot.transactions.find(row => row.id === expected.id && active(row));
        if (row) intended.set(`transaction:${row.id}`, { kind: 'transaction', row });
      }
      const row = step.after.schedule && snapshot.schedules.find(row => row.id === step.after.schedule!.id && active(row));
      if (row) intended.set(`schedule:${row.id}`, { kind: 'schedule', row });
    }
    let candidates = [...intended.values()];
    if (candidates.length === 2 && candidates.every(candidate => candidate.kind === 'transaction')
      && candidates[0]!.row.transferred_id === candidates[1]!.row.id && candidates[1]!.row.transferred_id === candidates[0]!.row.id
      && transactionEntry(candidates[0]!.row, snapshot)?.type === 'transfer') candidates = candidates.filter(candidate => Number(candidate.row.amount) < 0);
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      primary = { kind: candidate.kind, id: candidate.row.id, role: 'primary', provenance: 'unknown', beforeState: 'unknown', before: null, after: candidate.row };
      current = candidate.row;
    }
  }
  const evidence: FinancialWriteEvidence = { budgetId: snapshot.budgetId, objects: [] };
  for (const kind of ['transaction', 'schedule', 'rule', 'schedule_next_date'] as const) for (const row of rows(kind)) {
    const saved = preview.evidence.objects.find(object => object.kind === kind && object.id === row.id);
    evidence.objects.push({ kind, id: row.id, role: primary?.kind === kind && primary.id === row.id ? 'primary' : kind === 'rule' ? 'schedule_rule' : kind === 'schedule_next_date' ? 'next_date' : row.isChild ? 'split_child' : 'counterpart',
      provenance: saved?.provenance || 'unknown', beforeState: saved?.beforeState || 'unknown', before: saved?.before || null, after: row });
  }
  for (const saved of preview.evidence.objects) if (!evidence.objects.some(object => object.kind === saved.kind && object.id === saved.id)) {
    evidence.objects.push({ ...saved, role: primary?.kind === saved.kind && primary.id === saved.id ? 'primary' : saved.role === 'primary' ? 'counterpart' : saved.role, after: null });
  }
  const entry = current ? primary?.kind === 'transaction' ? transactionEntry(current, snapshot) : scheduleEntry(current, snapshot) : undefined;
  return structuredClone({ outcome: 'kept' as const, resolution: 'kept_actual' as const, correctionId: preview.id, snapshot, evidence, entry,
    transactionId: current && primary?.kind === 'transaction' ? current.id : undefined, scheduleId: current && primary?.kind === 'schedule' ? current.id : undefined });
}
