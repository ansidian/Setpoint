import { expect, it } from 'vitest';
import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceWorkspace, JournalRange, JournalTransaction } from '../../../shared/types/finances';
import { paymentCalendarPresentation, paymentPresentation } from './paymentPresentationModel';
import { monthlyPaymentAmounts } from './monthlyPaymentModel';
const occurrence = (fields: Partial<ActualBillOccurrence> = {}): ActualBillOccurrence => ({ id: 'september', scheduleId: 'internet', name: 'Internet', payee: 'Provider', amount: 110, next_date: '2026-09-01', paid: true, type: 'bill', openActionDisabled: false, ...fields });
const transaction = (id: string, fields: Partial<JournalTransaction> = {}): JournalTransaction => ({ id, date: '2026-09-01', amountCents: -11000, payee: 'Provider', payeeId: 'provider', account: 'Checking', accountId: 'checking', category: '', notes: '', scheduleId: 'internet', transferId: null, parentId: null, isParent: false, isChild: false, cleared: true, reconciled: false, ...fields });
const range = (transactions: JournalTransaction[], fields: Partial<JournalRange> = {}): JournalRange => ({ start: '2025-10-01', end: '2026-09-09', transactions, relatives: [], truncated: false, ...fields });
const workspace = (recurring: ActualBillOccurrence[] = [], recordedHistory?: JournalRange): FinanceWorkspace => ({ budgetId: 'budget', start: '2025-10-01', end: '2026-09-09', updatedAt: null, issues: [], truncated: false, recurring, recordedHistory });

it('shows a schedule paid from Actual and keeps the next cycle distinct', () => {
  const data = workspace([occurrence({ paymentTransactionIds: ['paid'] }), occurrence({ id: 'october', next_date: '2026-10-01', paid: false })], range([transaction('paid')]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: 'Internet', status: 'paid', amountCents: 11000, amountKind: 'payment', dueDate: '2026-09-01', paymentDate: '2026-09-01', nextOccurrence: { next_date: '2026-10-01' }, payments: [{ target: { view: 'journal', transactionId: 'paid', date: '2026-09-01' } }], target: { view: 'schedule', scheduleId: 'internet', date: '2026-09-01' } });
  expect(paymentCalendarPresentation(rows, '2026-09').payments).toEqual([expect.objectContaining({ date: '2026-09-01', status: 'recorded', amountCents: 11000, rowId: rows[0]!.id })]);
});

it('keeps early and multiple recordings distinct from a due date across months', () => {
  const data = workspace([occurrence({ next_date: '2026-09-05', paymentTransactionIds: ['first', 'second'] })], range([transaction('first', { date: '2026-08-29', amountCents: -6000 }), transaction('second', { date: '2026-09-02', amountCents: -5000 })]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ dueDate: '2026-09-05', paymentDate: '2026-09-02', amountCents: 11000, payments: [{ id: 'second' }, { id: 'first' }] });
  expect(paymentCalendarPresentation(rows, '2026-09').payments.map(item => item.date)).toEqual(['2026-09-02']);
  expect(paymentPresentation(data, '2026-08').rows[0]).toMatchObject({ dueDate: '2026-09-05', status: 'paid' });
});

it('does not settle an unlinked occurrence from schedule history, and does not claim unpaid when history fails', () => {
  const data = workspace([occurrence({ paid: false })], range([transaction('unlinked', { date: '2026-09-03' })]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows.map(row => row.status)).toEqual(['scheduled', 'paid']);
  expect(rows[0]).toMatchObject({ payments: [], amountKind: 'estimate', amountCents: 11000, history: [{ id: 'unlinked' }] });
  const calendar = paymentCalendarPresentation(rows, '2026-09');
  expect(calendar.scheduledDays).toEqual([{ date: '2026-09-01', count: 1, amountCents: 11000 }]);
  expect(paymentPresentation(data, '2026-09', null)).toMatchObject({ historyComplete: false, rows: [{ status: 'scheduled', payments: [] }] });
  expect(paymentPresentation(data, '2026-09', range([], { truncated: true })).historyComplete).toBe(false);
});

it('preserves multiple recurring cycles and distinguishes received and transferred amounts', () => {
  const data = workspace([occurrence({ type: 'income', paymentTransactionIds: ['income'] }), occurrence({ id: 'second', next_date: '2026-09-08', type: 'transfer', paymentTransactionIds: ['transfer'] })],
    range([transaction('income', { amountCents: 11000 }), transaction('transfer', { date: '2026-09-08', transferId: 'pair' }), transaction('pair', { date: '2026-09-09', transferId: 'transfer', accountId: 'savings', amountCents: 11000, scheduleId: null, payeeId: null })]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.status)).toEqual(['received', 'transferred']);
  expect(rows[1]!.payments).toHaveLength(1);
  expect(rows[1]!.amountCents).toBe(11000);
});

it('attributes only a matching split child and never duplicates the parent total', () => {
  const data = workspace([occurrence({ paymentTransactionIds: ['internet-child'] })], range([
    transaction('parent', { isParent: true, scheduleId: null, payeeId: null, amountCents: -15000 }),
    transaction('internet-child', { isChild: true, parentId: 'parent', amountCents: -11000 }),
    transaction('other-child', { isChild: true, parentId: 'parent', scheduleId: null, payeeId: null, amountCents: -4000 }),
  ]));
  expect(paymentPresentation(data, '2026-09').rows[0]).toMatchObject({ amountCents: 11000, payments: [{ id: 'internet-child', target: { transactionId: 'internet-child' } }] });
});

it('keeps a deleted legacy paid occurrence as evidence beside one current Journal payment', () => {
  const data = workspace([occurrence({ id: 'legacy', next_date: '2026-09-04' })], range([transaction('current')]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'paid', dueDate: null, paymentDate: '2026-09-01', payments: [{ id: 'current' }], unconfirmedOccurrences: [{ id: 'legacy', next_date: '2026-09-04' }] });
  expect(paymentCalendarPresentation(rows, '2026-09').payments).toEqual([expect.objectContaining({ id: 'current', date: '2026-09-01' })]);
});

it('does not resurrect an explicitly linked transaction that was deleted from complete history', () => {
  const data = workspace([occurrence({ paymentTransactionIds: ['deleted'] })], range([]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'unknown', amountCents: null, unconfirmedOccurrences: [{ paymentTransactionIds: ['deleted'] }] });
  expect(paymentCalendarPresentation(rows, '2026-09').payments).toEqual([]);
});

it('counts reciprocal transfer pairs once across rows, the calendar, and monthly history', () => {
  const transfer = (id: string, date: string, amountCents: number) => [
    transaction(`${id}-out`, { date, scheduleId: 'card', amountCents: -amountCents, transferId: `${id}-in` }),
    transaction(`${id}-in`, { date, scheduleId: null, accountId: 'card', account: 'Card account', amountCents, transferId: `${id}-out` }),
  ];
  const data = workspace([occurrence({ id: 'card-september', scheduleId: 'card', name: 'Card payment', type: 'transfer', amount: 200, next_date: '2026-09-02', paymentTransactionIds: ['first-out', 'first-in'] })],
    range([...transfer('first', '2026-09-02', 20000), ...transfer('second', '2026-09-08', 15000)]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows.map(row => [row.status, row.amountCents])).toEqual([['transferred', 20000], ['transferred', 15000]]);
  expect(rows[0]!.payments[0]!.ids).toEqual(expect.arrayContaining(['first-out', 'first-in']));
  expect(paymentCalendarPresentation(rows, '2026-09').payments.filter(item => item.status === 'recorded')).toHaveLength(2);
  expect(monthlyPaymentAmounts(rows[0]!.history, '2026-09')[11]).toMatchObject({ amountCents: 35000, paymentCount: 2 });
});
