import type { CorrectionRow, CorrectionSnapshot } from '../../shared/types/financial-corrections';
import { getDemoSeed } from './store';

// Raw fictional Actual objects are shared by exact ID, independently of saved receipts.
const collections = ['transactions', 'schedules', 'rules', 'dates'] as const;
const live = Object.fromEntries(collections.map(name => [name, new Map<string, CorrectionRow | null>()])) as Record<typeof collections[number], Map<string, CorrectionRow | null>>;
const dateKey = (value: unknown) => String(value || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

export function currentDemoFinanceSnapshot(saved: CorrectionSnapshot): CorrectionSnapshot {
  const result = structuredClone(saved);
  for (const name of collections) result[name] = saved[name].flatMap(row => {
    if (!live[name].has(row.id)) live[name].set(row.id, structuredClone(row));
    const current = live[name].get(row.id);
    return current ? [structuredClone(current)] : [];
  });
  return result;
}

export function publishDemoFinanceSnapshot(before: CorrectionSnapshot, after: CorrectionSnapshot): void {
  const seed = getDemoSeed();
  for (const name of collections) {
    for (const row of before[name]) if (!after[name].some(next => next.id === row.id)) live[name].set(row.id, null);
    for (const row of after[name]) live[name].set(row.id, structuredClone(row));
  }
  const affectedTransactions = new Set([...before.transactions, ...after.transactions].map(row => row.id));
  seed.transactions = seed.transactions.filter(row => !affectedTransactions.has(row.id));
  for (const row of after.transactions) {
    const amount = Number(row.amount);
    seed.transactions.push({ id: row.id, accountId:String(row.acct || ''), payeeId:String(row.description || ''),
      scheduleId:row.schedule ? String(row.schedule) : null, transferId:row.transferred_id ? String(row.transferred_id) : null,
      parentId:row.parent_id ? String(row.parent_id) : null, isParent:!!row.is_parent, isChild:!!row.is_child, cleared:!!row.cleared, reconciled:!!row.reconciled,
      amount: Math.abs(amount) / 100, date: dateKey(row.date),
      direction: amount > 0 ? 'income' : 'expense',
      transferAccountId: row.transferred_id ? String(after.transactions.find(other => other.id === row.transferred_id)?.acct || '') : null,
      account: seed.actualMetadata.accounts.find(account => account.id === row.acct)?.name || 'Demo account',
      payee: after.payees.find(payee => payee.id === row.description)?.name as string || 'Fictional payee',
      category: after.categories.find(category => category.id === row.category)?.name as string || 'Uncategorized', notes: String(row.notes || '') });
  }
  const affectedSchedules = new Set([...before.schedules, ...after.schedules].map(row => row.id));
  seed.bills = seed.bills.filter(row => !affectedSchedules.has(row.scheduleId));
  for (const id of affectedSchedules) delete seed.currentDashboard.payeeMap[id];
  for (const row of after.schedules) {
    const rule = after.rules.find(rule => rule.id === row.rule);
    const conditions = (rule?.conditions || []) as Array<{ field: string; value: unknown }>;
    const value = (field: string) => conditions.find(condition => condition.field === field)?.value;
    const date = after.dates.find(date => date.schedule_id === row.id);
    const nextDate = dateKey(date?.local_next_date || date?.base_next_date);
    const schedulePayee = after.payees.find(payee => payee.id === value('payee'));
    const payee = String(schedulePayee?.name || row.name || 'Fictional bill');
    const amountCents = Number(value('amount') || 0);
    const type = schedulePayee?.transfer_acct ? 'transfer' : amountCents > 0 ? 'income' : 'bill';
    seed.bills.push({ id: `${row.id}:${nextDate}`, scheduleId: row.id, name: String(row.name || payee), payee,
      amount: Math.abs(amountCents) / 100, next_date: nextDate, paid: false, paymentTransactionIds:[], type, openActionDisabled: true });
    seed.currentDashboard.payeeMap[row.id] = payee;
  }
  seed.currentDashboard.bills = seed.bills;
  seed.currentDashboard.allSchedules = seed.bills;
}

export function announceDemoFinanceChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ea-demo-financial-changed'));
}
