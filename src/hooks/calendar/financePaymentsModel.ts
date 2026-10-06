import type { FinanceWorkspace, JournalRange } from '../../../shared/types/finances';
import { financeActivityDays, shiftFinanceDate, shiftFinanceMonth } from './financeActivityModel';
import type { FinanceActivityDay } from './financeActivityModel';

/** One calendar entry from the shared Payments row projection. */
export interface FinancePayment {
  id: string;
  name: string;
  date: string;
  amountCents: number | null;
  direction: 'income' | 'outflow' | 'transfer';
  status: 'scheduled' | 'recorded';
  /** Payments ledger row that owns this entry. */
  rowId: string;
}
export interface ScheduledPaymentDay { date: string; count: number; amountCents: number | null }

/** Daily recorded totals for exact Actual schedule and transaction identities only; never match payment names or amounts. */
export function financePaymentDays(data: FinanceWorkspace, range: JournalRange | null, month: string): FinanceActivityDay[] {
  const last = shiftFinanceDate(`${shiftFinanceMonth(month, 1)}-01`, -1);
  const scheduleIds = new Set(data.recurring.map(row => row.scheduleId));
  data.paymentItems?.forEach(item => scheduleIds.add(item.scheduleId));
  const paymentIds = new Set(data.recurring.flatMap(row => row.paymentTransactionIds || []));
  const belongs = (row: JournalRange['transactions'][number]) => paymentIds.has(row.id) || !!row.scheduleId && scheduleIds.has(row.scheduleId);
  // Keep relatives intact so split parents and both sides of transfers retain Journal topology.
  const filtered = range ? { ...range, relatives: [...range.relatives, ...range.transactions], transactions: range.transactions.filter(row => belongs(row)
    || range.transactions.some(related => belongs(related) && (related.parentId === row.id || related.transferId === row.id))) } : null;
  const recordedDays = filtered ? financeActivityDays(filtered) : [];
  for (const day of recordedDays) {
    if (day.entries.some(entry => entry.kind === 'split' && !belongs(entry.transaction) && !entry.children.every(belongs))) day.complete = false;
  }
  const byDate = new Map(recordedDays.map(day => [day.date, day]));
  const days: FinanceActivityDay[] = [];
  for (let date = `${month}-01`; date <= last; date = shiftFinanceDate(date, 1)) {
    days.push(byDate.get(date) || { date, entries: [], incomeCents: 0, outflowCents: 0, transfers: 0, transferCents: 0, complete: date > data.end });
  }
  return days;
}
