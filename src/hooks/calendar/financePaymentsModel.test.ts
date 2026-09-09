import { expect, it } from 'vitest';
import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceUtility, FinanceWorkspace, JournalRange, JournalTransaction, UtilityStatement } from '../../../shared/types/finances';
import { financePayments } from './financePaymentsModel';

const occurrence = (fields: Partial<ActualBillOccurrence> = {}): ActualBillOccurrence => ({
  id: 'rent-september', scheduleId: 'rent', name: 'Rent', payee: 'Landlord', amount: 100,
  next_date: '2026-09-08', paid: false, type: 'bill', openActionDisabled: false, ...fields,
});
const transaction = (id: string, fields: Partial<JournalTransaction> = {}): JournalTransaction => ({
  id, date: '2026-09-07', amountCents: -10000, payee: 'Landlord', payeeId: 'p', account: 'Checking', accountId: 'checking',
  category: 'Rent', notes: '', scheduleId: 'rent', transferId: null, parentId: null,
  isParent: false, isChild: false, cleared: false, reconciled: false, ...fields,
});
const range = (transactions: JournalTransaction[], fields: Partial<JournalRange> = {}): JournalRange => ({
  start: '2026-09-01', end: '2026-09-08', transactions, relatives: [], truncated: false, ...fields,
});
const statement = (fields: Partial<UtilityStatement> = {}): UtilityStatement => ({
  id: 'bill', utilityId: 'power', emailUid: 'email', subject: 'Electric bill', receivedAt: '2026-09-01',
  statementDate: null, dueDate: '2026-09-22', amountCents: 9000, amountKind: 'total_due', nothingDue: false,
  creditCents: null, newChargesCents: null, carriedBalanceCents: null, providerReference: 'bill-reference',
  activity: null, paymentTransactionIds: [], paymentDate: null, recordedTotalCents: null, feeCents: null, issue: null, ...fields,
});
const utility = (fields: Partial<FinanceUtility> = {}): FinanceUtility => ({
  identity: { id: 'power', label: 'Electricity', provider: 'Power', budgetId: 'budget', payeeId: 'power-payee', scheduleIds: ['power-schedule'], sourceSenders: [] },
  statements: [statement()], occurrences: [occurrence({ id: 'power-occurrence', scheduleId: 'power-schedule', next_date: '2026-09-22' })], ...fields,
});
const workspace = (fields: Partial<FinanceWorkspace> = {}): FinanceWorkspace => ({
  budgetId: 'budget', utilities: [], recurring: [occurrence()], start: '2025-09-08', end: '2026-09-08', updatedAt: null, issues: [], truncated: false, ...fields,
});

it('uses the actual recording date and amount, and removes a paid occurrence from scheduled payments', () => {
  const model = financePayments(workspace({ recurring: [occurrence({ paid: true, paymentTransactionIds: ['paid'] })] }), range([transaction('paid', { amountCents: -10500 })]), '2026-09');
  expect(model.payments).toEqual([expect.objectContaining({ id: 'paid', date: '2026-09-07', amountCents: 10500, status: 'recorded', target: { view: 'journal', date: '2026-09-07', transactionId: 'paid' } })]);
  expect(model.scheduledDays).toEqual([]);
  expect(model.days.find(day => day.date === '2026-09-07')).toMatchObject({ outflowCents: 10500 });
  expect(model.days.find(day => day.date === '2026-09-08')).toMatchObject({ outflowCents: 0 });
});

it('keeps a recorded occurrence discoverable without inventing its recording date or amount', () => {
  const model = financePayments(workspace({ recurring: [occurrence({ paid: true })] }), range([]), '2026-09');
  expect(model.payments).toEqual([expect.objectContaining({ status: 'recorded', date: null, amountCents: null, scheduledDate: '2026-09-08' })]);
  expect(model.days.every(day => day.entries.length === 0)).toBe(true);
  expect(model.scheduledDays).toEqual([]);
});

it('uses exact utility membership and preserves Journal transfer and split topology without ordinary purchases', () => {
  const model = financePayments(workspace({ utilities: [utility()], recurring: [occurrence({ type: 'transfer' })] }), range([
    transaction('parent', { scheduleId: null, payeeId: 'power-payee', isParent: true, amountCents: -9000 }),
    transaction('child1', { scheduleId: null, payeeId: null, isChild: true, parentId: 'parent', amountCents: -5000 }),
    transaction('child2', { scheduleId: null, payeeId: null, isChild: true, parentId: 'parent', amountCents: -4000 }),
    transaction('sent', { transferId: 'received' }),
    transaction('received', { scheduleId: null, transferId: 'sent', amountCents: 10000, accountId: 'savings' }),
    transaction('ordinary', { scheduleId: null, payee: 'Rent', amountCents: -8800 }),
  ]), '2026-09');
  expect(model.payments.filter(payment => payment.status === 'recorded')).toHaveLength(2);
  expect(model.payments.find(payment => payment.id === 'parent')).toMatchObject({ utilityId: 'power', amountCents: 9000 });
  expect(model.days.find(day => day.date === '2026-09-07')).toMatchObject({ outflowCents: 9000, transfers: 1, complete: true });
});

it('prefers saved utility statements to schedule estimates, deduplicates exact statement identities, and excludes nothing due', () => {
  const bill = statement();
  const model = financePayments(workspace({ recurring: [], utilities: [utility({ statements: [bill, { ...bill, id: 'another-email' }] }), utility({ identity: { ...utility().identity, id: 'credit' }, statements: [statement({ nothingDue: true })] })] }), range([]), '2026-09');
  expect(model.scheduledDays).toEqual([{ date: '2026-09-22', count: 1, amountCents: 9000 }]);
  expect(model.payments).toEqual([expect.objectContaining({ id: 'bill', utilityId: 'power', amountCents: 9000, target: { view: 'utilities', utilityId: 'power', month: '2026-09', statementId: 'bill' } })]);
});

it('withholds missing scheduled amounts and incomplete recorded totals while keeping dates navigable', () => {
  const model = financePayments(workspace({ recurring: [], utilities: [utility({ statements: [statement({ amountCents: null })] })] }), range([], { truncated: true }), '2026-09');
  expect(model.scheduledDays).toEqual([{ date: '2026-09-22', count: 1, amountCents: null }]);
  expect(model.days.find(day => day.date === '2026-09-07')?.complete).toBe(false);
  expect(model.days.find(day => day.date === '2026-09-22')?.complete).toBe(true);
  expect(financePayments(workspace(), null, '2026-09').days.find(day => day.date === '2026-09-07')?.complete).toBe(false);
  expect(financePayments(workspace(), null, '2026-10').payments).toEqual([]);
});

it('does not attribute an entire mixed purchase to a scheduled split child', () => {
  const model = financePayments(workspace(), range([
    transaction('parent', { scheduleId: null, isParent: true, amountCents: -15000 }),
    transaction('rent-part', { parentId: 'parent', isChild: true, amountCents: -10000 }),
    transaction('other-part', { scheduleId: null, parentId: 'parent', isChild: true, amountCents: -5000 }),
  ]), '2026-09');
  expect(model.payments.find(payment => payment.id === 'parent')?.amountCents).toBeNull();
  expect(model.days.find(day => day.date === '2026-09-07')?.complete).toBe(false);
});
