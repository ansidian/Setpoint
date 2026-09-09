import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceWorkspace, JournalRange } from '../../../shared/types/finances';
import type { FinanceDestination } from '../../components/finances/financesNavigation';
import { financeActivityDays, shiftFinanceDate, shiftFinanceMonth } from './financeActivityModel';
import type { FinanceActivityDay } from './financeActivityModel';

export interface FinancePayment {
  id: string;
  name: string;
  payee?: string;
  date: string | null;
  scheduledDate?: string;
  amountCents: number | null;
  direction: 'income' | 'outflow' | 'transfer';
  status: 'scheduled' | 'recorded';
  utilityId?: string;
  target: FinanceDestination;
}
export interface ScheduledPaymentDay { date: string; count: number; amountCents: number | null }

/** Exact schedule, payee and transaction identities only; never match payment names or amounts. */
export function financePayments(data: FinanceWorkspace, range: JournalRange | null, month: string) {
  const last = shiftFinanceDate(`${shiftFinanceMonth(month, 1)}-01`, -1);
  const allOccurrences = [...data.recurring, ...data.utilities.flatMap(utility => utility.occurrences)];
  const scheduleIds = new Set(allOccurrences.map(row => row.scheduleId));
  data.utilities.forEach(utility => utility.identity.scheduleIds.forEach(id => scheduleIds.add(id)));
  const paymentIds = new Set(allOccurrences.flatMap(row => row.paymentTransactionIds || []));
  data.utilities.forEach(utility => utility.statements.forEach(statement => statement.paymentTransactionIds.forEach(id => paymentIds.add(id))));
  const belongs = (row: JournalRange['transactions'][number]) => paymentIds.has(row.id)
    || !!row.scheduleId && scheduleIds.has(row.scheduleId)
    || data.utilities.some(utility => utility.identity.payeeId === row.payeeId);
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
    days.push(byDate.get(date) || { date, entries: [], incomeCents: 0, outflowCents: 0, transfers: 0, complete: date > data.end });
  }
  const payments: FinancePayment[] = recordedDays.flatMap(day => day.entries.map(entry => {
    const rows = [entry.transaction, ...entry.children, ...(entry.counterpart ? [entry.counterpart] : [])];
    const utility = data.utilities.find(item => rows.some(row => row.payeeId === item.identity.payeeId || !!row.scheduleId && item.identity.scheduleIds.includes(row.scheduleId))
      || item.statements.some(statement => statement.paymentTransactionIds.some(id => entry.ids.includes(id))));
    const transfer = rows.some(row => row.transferId || row.transferAccountId);
    return { id: entry.id, name: utility?.identity.label || entry.transaction.payee, date: day.date,
      amountCents: entry.incomplete || entry.kind === 'split' && !belongs(entry.transaction) && !entry.children.every(belongs) ? null : Math.abs(entry.transaction.amountCents), direction: transfer ? 'transfer' : entry.transaction.amountCents > 0 ? 'income' : 'outflow',
      status: 'recorded', utilityId: utility?.identity.id,
      target: { view: 'journal', date: day.date, transactionId: entry.id } } satisfies FinancePayment;
  }));
  const addOccurrence = (row: ActualBillOccurrence, utilityId?: string) => {
    if (!row.next_date.startsWith(month)) return;
    if (row.paid) {
      // Paid occurrences without a hydrated exact recording stay discoverable, but never receive a fabricated date/amount.
      const linked = row.paymentTransactionIds || [];
      if (!utilityId && !recordedDays.some(day => day.entries.some(entry => entry.ids.some(id => linked.includes(id))))) {
        payments.push({ id: row.id, name: row.name, payee: row.payee, date: null, scheduledDate: row.next_date, amountCents: null,
          direction: row.type === 'bill' ? 'outflow' : row.type, status: 'recorded', target: { view: 'schedule', scheduleId: row.scheduleId, date: row.next_date } });
      }
      return;
    }
    payments.push({ id: row.id, name: row.name, payee: row.payee, date: row.next_date, amountCents: Math.round(Math.abs(row.amount) * 100),
      direction: row.type === 'bill' ? 'outflow' : row.type, status: 'scheduled', utilityId,
      target: utilityId ? { view: 'utilities', utilityId, month } : { view: 'schedule', scheduleId: row.scheduleId, date: row.next_date } });
  };
  data.recurring.forEach(row => addOccurrence(row));
  for (const utility of data.utilities) {
    const seen = new Set<string>();
    for (const statement of utility.statements) {
      if (!statement.dueDate?.startsWith(month)) continue;
      const key = statement.providerReference ? `${statement.providerReference}:${statement.dueDate}:${statement.amountCents}` : statement.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const occurrence = utility.occurrences.find(row => row.next_date === statement.dueDate);
      if (statement.nothingDue || statement.issue || statement.paymentRecorded || statement.paymentTransactionIds.length || occurrence?.paid) continue;
      payments.push({ id: statement.id, name: utility.identity.label, date: statement.dueDate,
        amountCents: statement.amountCents, direction: 'outflow', status: 'scheduled', utilityId: utility.identity.id,
        target: { view: 'utilities', utilityId: utility.identity.id, month, statementId: statement.id } });
    }
    for (const row of utility.occurrences) {
      if (!utility.statements.some(statement => statement.dueDate === row.next_date)) addOccurrence(row, utility.identity.id);
    }
  }
  const scheduledDays = new Map<string, ScheduledPaymentDay>();
  for (const payment of payments) {
    if (payment.status !== 'scheduled' || !payment.date) continue;
    const day = scheduledDays.get(payment.date) || { date: payment.date, count: 0, amountCents: 0 };
    day.count += 1;
    day.amountCents = day.amountCents === null || payment.amountCents === null ? null : day.amountCents + payment.amountCents;
    scheduledDays.set(day.date, day);
  }
  return { payments, days, scheduledDays: [...scheduledDays.values()] };
}
