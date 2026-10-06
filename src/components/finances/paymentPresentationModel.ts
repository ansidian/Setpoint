import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceWorkspace, JournalRange, JournalTransaction } from '../../../shared/types/finances';
import type { FinancePayment, ScheduledPaymentDay } from '../../hooks/calendar/financePaymentsModel';
import type { FinanceDestination } from './financesNavigation';
import { journalEntries } from './financeWorkspaceModel';

export const paymentStatusLabels = { paid: 'Paid', received: 'Received', transferred: 'Transferred', scheduled: 'Scheduled', unknown: 'Status unknown' };

export interface RecordedPayment {
  id: string;
  ids: string[];
  date: string;
  amountCents: number | null;
  account: string;
  notes: string;
  payee: string;
  cleared: boolean;
  reconciled: boolean;
  target: FinanceDestination;
}
export interface PaymentPresentationRow {
  id: string;
  name: string;
  provider: string;
  scheduleId: string;
  status: 'paid' | 'received' | 'transferred' | 'scheduled' | 'unknown';
  direction: 'outflow' | 'income' | 'transfer';
  dueDate: string | null;
  paymentDate: string | null;
  amountCents: number | null;
  amountKind: 'payment' | 'estimate' | null;
  payments: RecordedPayment[];
  history: RecordedPayment[];
  /** Schedule claims without a current exact Journal recording; never payment facts. */
  unconfirmedOccurrences: ActualBillOccurrence[];
  nextOccurrence?: ActualBillOccurrence;
  target: Extract<FinanceDestination, { view: 'schedule' }>;
}
interface Owner {
  id: string;
  name: string;
  provider: string;
  scheduleId: string;
  occurrences: ActualBillOccurrence[];
}
const directionFor = (occurrence?: ActualBillOccurrence): PaymentPresentationRow['direction'] => occurrence?.type === 'income' ? 'income' : occurrence?.type === 'transfer' ? 'transfer' : 'outflow';
const paidStatus = (direction: PaymentPresentationRow['direction']) => direction === 'income' ? 'received' as const : direction === 'transfer' ? 'transferred' as const : 'paid' as const;
const sumPayments = (payments: RecordedPayment[]) => payments.some(payment => payment.amountCents === null) ? null : payments.reduce((sum, payment) => sum + payment.amountCents!, 0);

/** Schedule membership supplies history. Only explicit transaction links settle an occurrence. */
export function paymentPresentation(data: FinanceWorkspace, month: string, history: JournalRange | null | undefined = data.recordedHistory) {
  const owners = new Map<string, Owner>();
  for (const occurrence of data.recurring) {
    const existing = owners.get(occurrence.scheduleId);
    if (existing) existing.occurrences.push(occurrence);
    else owners.set(occurrence.scheduleId, { id: `schedule:${occurrence.scheduleId}`, name: occurrence.name, provider: occurrence.payee,
      scheduleId: occurrence.scheduleId, occurrences: [occurrence] });
  }
  const entries = history ? journalEntries(history) : [];
  const rows: PaymentPresentationRow[] = [];
  for (const owner of owners.values()) {
    const explicitIds = new Set(owner.occurrences.flatMap(item => item.paymentTransactionIds || []));
    const belongs = (transaction: JournalTransaction) => explicitIds.has(transaction.id) || transaction.scheduleId === owner.scheduleId;
    const consumed = new Set<string>();
    const records: Array<RecordedPayment & { direction: PaymentPresentationRow['direction'] }> = [];
    for (const entry of entries) {
      const candidates = belongs(entry.transaction) ? [entry.transaction] : entry.children.filter(belongs);
      if (!candidates.length && entry.counterpart && belongs(entry.counterpart)) candidates.push(entry.counterpart);
      for (const transaction of candidates) {
        const wholeEntry = transaction.id === entry.transaction.id;
        const ids = wholeEntry ? entry.ids : [transaction.id];
        if (entry.counterpart && !entry.children.length) ids.push(entry.counterpart.id);
        if (ids.some(id => consumed.has(id))) continue;
        ids.forEach(id => consumed.add(id));
        const transfer = !!transaction.transferId || !!transaction.transferAccountId;
        records.push({ id: transaction.id, ids: [...new Set(ids)], date: transaction.date,
          amountCents: wholeEntry && entry.incomplete ? null : Math.abs(transaction.amountCents),
          account: transaction.account, notes: transaction.notes, payee: transaction.payee,
          cleared: transaction.cleared, reconciled: transaction.reconciled,
          direction: transfer ? 'transfer' : transaction.amountCents > 0 ? 'income' : 'outflow',
          target: { view: 'journal', date: transaction.date, transactionId: transaction.id } });
      }
    }
    records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const unconfirmedOccurrences = owner.occurrences.filter(occurrence =>
      (occurrence.paid || !!occurrence.paymentTransactionIds?.length)
      && !records.some(payment => payment.ids.some(id => occurrence.paymentTransactionIds?.includes(id))));
    const assigned = new Set<string>();
    const targetFor = (date: string | null): PaymentPresentationRow['target'] => ({ view: 'schedule', scheduleId: owner.scheduleId, ...(date ? { date } : {}) });
    const base = { name: owner.name, provider: owner.provider, scheduleId: owner.scheduleId, history: records, unconfirmedOccurrences };
    const nextAfter = (date: string) => [...owner.occurrences].filter(item => !item.paid && item.next_date > date).sort((a, b) => a.next_date.localeCompare(b.next_date))[0];
    const ownerRows: PaymentPresentationRow[] = [];
    for (const occurrence of owner.occurrences) {
      const links = new Set(occurrence.paymentTransactionIds || []);
      const payments = records.filter(payment => payment.ids.some(id => links.has(id)));
      // Reserve links even outside this month, so an early/late payment stays tied to its actual cycle.
      payments.forEach(payment => assigned.add(payment.id));
      if (!occurrence.next_date.startsWith(month) && !payments.some(payment => payment.date.startsWith(month))) continue;
      // A stale paid schedule can outlive a deleted transaction. Keep its claim in details,
      // rather than manufacturing a second paid row beside the authoritative Journal record.
      if (unconfirmedOccurrences.includes(occurrence)) continue;
      const direction = payments[0]?.direction || directionFor(occurrence);
      const dates = [...new Set(payments.map(payment => payment.date))].sort();
      ownerRows.push({ ...base, id: `${owner.id}:${occurrence.id}`, direction,
        status: payments.length ? paidStatus(direction) : 'scheduled',
        dueDate: occurrence.next_date, paymentDate: dates[dates.length - 1] || null,
        amountCents: payments.length ? sumPayments(payments) : Math.round(Math.abs(occurrence.amount) * 100),
        amountKind: payments.length ? 'payment' : 'estimate',
        payments, nextOccurrence: nextAfter(occurrence.next_date), target: targetFor(occurrence.next_date) });
    }
    for (const payment of records) {
      if (assigned.has(payment.id) || !payment.date.startsWith(month)) continue;
      ownerRows.push({ ...base, id: `${owner.id}:payment:${payment.id}`, status: paidStatus(payment.direction), direction: payment.direction,
        dueDate: null, paymentDate: payment.date, amountCents: payment.amountCents, amountKind: 'payment',
        payments: [payment], nextOccurrence: nextAfter(payment.date), target: targetFor(payment.date) });
    }
    if (!ownerRows.length && unconfirmedOccurrences.some(occurrence => occurrence.next_date.startsWith(month))) {
      ownerRows.push({ ...base, id: `${owner.id}:empty`, status: 'unknown', direction: directionFor(owner.occurrences[0]),
        dueDate: null, paymentDate: null, amountCents: null, amountKind: null,
        payments: [], nextOccurrence: nextAfter(`${month}-01`), target: targetFor(null) });
    }
    rows.push(...ownerRows);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name)
    || (a.dueDate || a.paymentDate || '').localeCompare(b.dueDate || b.paymentDate || '') || a.id.localeCompare(b.id));
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const requiredEnd = data.end < monthEnd ? data.end : monthEnd;
  return { rows, historyComplete: !!history && !history.truncated && history.start <= `${month}-01` && history.end >= requiredEnd };
}

/** All surfaces use these same dates and identities; a paid estimate never becomes a recording date. */
export function paymentCalendarPresentation(rows: PaymentPresentationRow[], month: string) {
  const payments: FinancePayment[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const payment of row.payments) {
      if (seen.has(payment.id) || !payment.date.startsWith(month)) continue;
      seen.add(payment.id);
      payments.push({ id: payment.id, name: row.name, date: payment.date, amountCents: payment.amountCents,
        direction: row.direction, status: 'recorded', rowId: row.id });
    }
    if (row.status === 'scheduled' && row.dueDate?.startsWith(month)) {
      payments.push({ id: row.id, name: row.name, date: row.dueDate, amountCents: row.amountCents,
        direction: row.direction, status: 'scheduled', rowId: row.id });
    }
  }
  const scheduled = new Map<string, ScheduledPaymentDay>();
  for (const payment of payments.filter(item => item.status === 'scheduled')) {
    const day = scheduled.get(payment.date) || { date: payment.date, count: 0, amountCents: 0 };
    day.count++;
    day.amountCents = day.amountCents === null || payment.amountCents === null ? null : day.amountCents + payment.amountCents;
    scheduled.set(day.date, day);
  }
  return { payments, scheduledDays: [...scheduled.values()] };
}
