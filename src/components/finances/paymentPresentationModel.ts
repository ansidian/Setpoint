import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceWorkspace, JournalRange, JournalTransaction, PaymentStatement } from '../../../shared/types/finances';
import type { FinancePayment, ScheduledPaymentDay } from '../../hooks/calendar/financePaymentsModel';
import type { FinanceDestination } from './financesNavigation';
import { journalEntries } from './financeWorkspaceModel';

export const paymentStatusLabels = { paid: 'Paid', received: 'Received', transferred: 'Transferred', scheduled: 'Scheduled', statement: 'Statement received', nothing_due: 'Nothing due', unknown: 'Status unknown' };

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
  group: 'utilities' | 'recurring';
  isCreditCard?: boolean;
  utilityId?: string;
  scheduleId?: string;
  status: 'paid' | 'received' | 'transferred' | 'scheduled' | 'statement' | 'nothing_due' | 'unknown';
  direction: 'outflow' | 'income' | 'transfer';
  dueDate: string | null;
  scheduledDate: string | null;
  paymentDate: string | null;
  amountCents: number | null;
  amountKind: 'payment' | 'statement' | 'estimate' | null;
  payments: RecordedPayment[];
  history: RecordedPayment[];
  statements: PaymentStatement[];
  statementHistory: PaymentStatement[];
  occurrence?: ActualBillOccurrence;
  /** Schedule claims without a current exact Journal recording; never payment facts. */
  unconfirmedOccurrences?: ActualBillOccurrence[];
  nextOccurrence?: ActualBillOccurrence;
  target: FinanceDestination;
}
interface Owner {
  id: string;
  name: string;
  provider: string;
  utilityId?: string;
  scheduleIds: string[];
  payeeId?: string;
  occurrences: ActualBillOccurrence[];
  statements: PaymentStatement[];
}
const directionFor = (occurrence?: ActualBillOccurrence): PaymentPresentationRow['direction'] => occurrence?.type === 'income' ? 'income' : occurrence?.type === 'transfer' ? 'transfer' : 'outflow';
const paidStatus = (direction: PaymentPresentationRow['direction']) => direction === 'income' ? 'received' as const : direction === 'transfer' ? 'transferred' as const : 'paid' as const;
const sumPayments = (payments: RecordedPayment[]) => payments.some(payment => payment.amountCents === null) ? null : payments.reduce((sum, payment) => sum + payment.amountCents!, 0);

/** Identity membership supplies history. Only explicit transaction links settle an occurrence. */
export function paymentPresentation(data: FinanceWorkspace, month: string, history: JournalRange | null | undefined = data.recordedHistory) {
  const owners: Owner[] = data.utilities.map(utility => ({ id: utility.identity.id, name: utility.identity.label,
    provider: utility.identity.provider, utilityId: utility.identity.id, scheduleIds: utility.identity.scheduleIds,
    payeeId: utility.identity.payeeId, occurrences: utility.occurrences, statements: utility.statements }));
  for (const occurrence of data.recurring) {
    if (owners.some(owner => owner.utilityId && owner.scheduleIds.includes(occurrence.scheduleId))) continue;
    const existing = owners.find(owner => owner.id === `schedule:${occurrence.scheduleId}`);
    if (existing) existing.occurrences.push(occurrence);
    else owners.push({ id: `schedule:${occurrence.scheduleId}`, name: occurrence.name, provider: occurrence.payee,
      scheduleIds: [occurrence.scheduleId], occurrences: [occurrence], statements: [] });
  }
  for (const statement of data.recurringStatements || []) {
    if (owners.some(owner => owner.utilityId && owner.scheduleIds.includes(statement.scheduleId))) continue;
    const existing = owners.find(owner => owner.id === `schedule:${statement.scheduleId}`);
    if (existing) existing.statements.push(statement);
    else {
      const item = data.paymentItems?.find(item => item.scheduleId === statement.scheduleId);
      owners.push({ id: `schedule:${statement.scheduleId}`, name: item?.name || 'Card payment', provider: item?.provider || '', scheduleIds: [statement.scheduleId], occurrences: [], statements: [statement] });
    }
  }
  const entries = history ? journalEntries(history) : [];
  const rows: PaymentPresentationRow[] = [];
  for (const owner of owners) {
    const explicitIds = new Set([...owner.occurrences.flatMap(item => item.paymentTransactionIds || []), ...owner.statements.flatMap(item => item.paymentTransactionIds)]);
    const belongs = (transaction: JournalTransaction) => explicitIds.has(transaction.id)
      || !!transaction.scheduleId && owner.scheduleIds.includes(transaction.scheduleId)
      || !!owner.payeeId && transaction.payeeId === owner.payeeId;
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
    const statements: PaymentStatement[][] = [];
    for (const statement of owner.statements) {
      const same = statements.find(group => group[0]!.id === statement.id || !!statement.providerReference
        && group[0]!.providerReference === statement.providerReference && group[0]!.dueDate === statement.dueDate && group[0]!.amountCents === statement.amountCents);
      if (same) same.push(statement); else statements.push([statement]);
    }
    const cycles: Array<{ statements: PaymentStatement[]; occurrence?: ActualBillOccurrence }> = statements.map(group => ({ statements: group }));
    for (const occurrence of owner.occurrences) {
      const matching = cycles.filter(cycle => cycle.statements[0]?.dueDate === occurrence.next_date);
      const sameDateOccurrences = owner.occurrences.filter(item => item.next_date === occurrence.next_date);
      if (matching.length === 1 && sameDateOccurrences.length === 1) matching[0]!.occurrence = occurrence;
      else cycles.push({ statements: [], occurrence });
    }
    const targetFor = (date: string | null, statement?: PaymentStatement): FinanceDestination => owner.utilityId
      ? { view: 'utilities', utilityId: owner.utilityId, month: date?.slice(0, 7) || month, ...(statement ? { statementId: statement.id } : {}) }
      : { view: 'schedule', scheduleId: owner.scheduleIds[0]!, ...(date ? { date } : {}) };
    const isCreditCard = !owner.utilityId && (owner.statements.length > 0 || data.paymentItems?.some(item => item.kind === 'credit_card' && item.scheduleId === owner.scheduleIds[0]));
    const base = { isCreditCard, name: owner.name, provider: owner.provider, group: owner.utilityId ? 'utilities' as const : 'recurring' as const,
      utilityId: owner.utilityId, scheduleId: owner.scheduleIds[0], history: records, statementHistory: owner.statements, unconfirmedOccurrences };
    const nextAfter = (date: string) => [...owner.occurrences].filter(item => !item.paid && item.next_date > date).sort((a, b) => a.next_date.localeCompare(b.next_date))[0];
    // A card statement is a balance/deadline, not a claim that a scheduled or recorded
    // transfer settles it. Monthly transfers remain independent, dated Journal facts.
    const cardStatements = isCreditCard ? statements.filter(group => {
      const source = group[0]!;
      return (source.dueDate || source.statementDate || source.receivedAt).startsWith(month);
    }) : [];
    if (cardStatements.length) {
      const monthTransfers = records.filter(payment => payment.date.startsWith(month));
      const scheduled = owner.occurrences.filter(item => !item.paid && item.next_date.startsWith(month));
      const scheduledTransfer = scheduled.length === 1 ? scheduled[0] : undefined;
      for (const sources of cardStatements) {
        const statement = sources[0]!;
        rows.push({ ...base, id: `${owner.id}:${statement.id}`, direction: 'transfer',
          status: statement.nothingDue ? 'nothing_due' : statement.issue ? 'unknown' : 'statement',
          dueDate: statement.dueDate, scheduledDate: scheduledTransfer?.next_date || null, paymentDate: null,
          amountCents: statement.amountCents, amountKind: 'statement', payments: monthTransfers,
          statements: sources, occurrence: scheduledTransfer, nextOccurrence: nextAfter(statement.dueDate || `${month}-01`), target: targetFor(statement.dueDate, statement) });
      }
      continue;
    }
    for (const cycle of cycles) {
      const statement = cycle.statements[0];
      const dueDate = statement?.dueDate || cycle.occurrence?.next_date || null;
      const links = new Set([...cycle.statements.flatMap(item => item.paymentTransactionIds), ...(cycle.occurrence?.paymentTransactionIds || [])]);
      const payments = records.filter(payment => payment.ids.some(id => links.has(id)));
      // Reserve links even outside this month, so an early/late payment stays tied to its actual cycle.
      payments.forEach(payment => assigned.add(payment.id));
      if (!dueDate?.startsWith(month) && !payments.some(payment => payment.date.startsWith(month))) continue;
      const unconfirmed = !!cycle.occurrence && unconfirmedOccurrences.includes(cycle.occurrence);
      // A stale paid schedule can outlive a deleted transaction. Keep its claim in details,
      // rather than manufacturing a second paid row beside the authoritative Journal record.
      if (unconfirmed && !cycle.statements.length) continue;
      const direction = payments[0]?.direction || directionFor(cycle.occurrence);
      const paid = payments.length > 0 || cycle.statements.some(item => item.paymentRecorded || item.paymentTransactionIds.length);
      const dates = [...new Set(payments.map(payment => payment.date))];
      rows.push({ ...base, id: `${owner.id}:${statement?.id || cycle.occurrence!.id}`, direction,
        status: paid ? paidStatus(direction) : statement?.nothingDue ? 'nothing_due' : statement?.issue || unconfirmed ? 'unknown' : 'scheduled',
        dueDate, scheduledDate: cycle.occurrence?.next_date || null, paymentDate: dates.sort()[dates.length - 1] || null,
        amountCents: payments.length ? sumPayments(payments) : statement?.amountCents ?? (cycle.occurrence ? Math.round(Math.abs(cycle.occurrence.amount) * 100) : null),
        amountKind: payments.length ? 'payment' : statement ? 'statement' : cycle.occurrence ? 'estimate' : null,
        payments, statements: cycle.statements, scheduleId: cycle.occurrence?.scheduleId || base.scheduleId, occurrence: cycle.occurrence, nextOccurrence: nextAfter(dueDate || `${month}-01`), target: targetFor(dueDate, statement) });
    }
    for (const payment of records) {
      if (assigned.has(payment.id) || !payment.date.startsWith(month)) continue;
      rows.push({ ...base, id: `${owner.id}:payment:${payment.id}`, status: paidStatus(payment.direction), direction: payment.direction,
        dueDate: null, scheduledDate: null, paymentDate: payment.date, amountCents: payment.amountCents, amountKind: 'payment',
        payments: [payment], statements: [], nextOccurrence: nextAfter(payment.date), target: targetFor(payment.date) });
    }
    const currentNotice = owner.statements.find(statement => statement.nothingDue && (statement.statementDate || statement.receivedAt).startsWith(month));
    const hasUnconfirmedCycle = unconfirmedOccurrences.some(occurrence => occurrence.next_date.startsWith(month));
    if ((owner.utilityId || hasUnconfirmedCycle) && !rows.some(row => owner.utilityId ? row.utilityId === owner.utilityId : !row.utilityId && row.scheduleId === owner.scheduleIds[0])) {
      rows.push({ ...base, id: `${owner.id}:empty`, status: currentNotice ? 'nothing_due' : 'unknown', direction: directionFor(owner.occurrences[0]),
        dueDate: null, scheduledDate: null, paymentDate: null, amountCents: null, amountKind: null,
        payments: [], statements: currentNotice ? [currentNotice] : [], nextOccurrence: nextAfter(`${month}-01`), target: targetFor(null) });
    }
  }
  rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)
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
      payments.push({ id: payment.id, name: row.name, payee: row.provider, date: payment.date, amountCents: payment.amountCents,
        direction: row.direction, status: 'recorded', rowId: row.id, utilityId: row.utilityId, target: row.target });
    }
    if ((row.status === 'scheduled' || row.status === 'statement') && row.dueDate?.startsWith(month)) {
      payments.push({ id: row.id, name: row.name, payee: row.provider, date: row.dueDate, amountCents: row.amountCents,
        direction: row.direction, status: row.status === 'statement' ? 'statement' : 'scheduled', rowId: row.id, utilityId: row.utilityId, target: row.target });
    }
  }
  const scheduledTransfers = new Set<string>();
  for (const row of rows) {
    if (!row.isCreditCard || !row.statements.length || !row.occurrence || row.occurrence.paid || !row.scheduledDate?.startsWith(month) || scheduledTransfers.has(row.occurrence.id)) continue;
    scheduledTransfers.add(row.occurrence.id);
    payments.push({ id: `${row.id}:transfer`, rowId: row.id, name: row.name, payee: row.provider,
      date: row.scheduledDate, amountCents: Math.round(Math.abs(row.occurrence.amount) * 100), direction: 'transfer', status: 'scheduled', target: row.target });
  }
  const scheduled = new Map<string, ScheduledPaymentDay>();
  for (const payment of payments.filter(item => item.status === 'scheduled')) {
    const day = scheduled.get(payment.date!) || { date: payment.date!, count: 0, amountCents: 0 };
    day.count++;
    day.amountCents = day.amountCents === null || payment.amountCents === null ? null : day.amountCents + payment.amountCents;
    scheduled.set(day.date, day);
  }
  return { payments, scheduledDays: [...scheduled.values()] };
}
