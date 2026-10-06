import { expect, it } from 'vitest';
import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceWorkspace, JournalRange, JournalTransaction } from '../../../shared/types/finances';
import { financePaymentDays } from './financePaymentsModel';

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
const workspace = (fields: Partial<FinanceWorkspace> = {}): FinanceWorkspace => ({
  budgetId: 'budget', recurring: [occurrence()], start: '2025-09-08', end: '2026-09-08', updatedAt: null, issues: [], truncated: false, ...fields,
});

it('totals exact recorded payments on their recording date', () => {
  const days = financePaymentDays(workspace({ recurring: [occurrence({ paid: true, paymentTransactionIds: ['paid'] })] }), range([transaction('paid', { scheduleId: null, amountCents: -10500 })]), '2026-09');
  expect(days).toHaveLength(30);
  expect(days.find(day => day.date === '2026-09-07')).toMatchObject({ outflowCents: 10500 });
  expect(days.find(day => day.date === '2026-09-08')).toMatchObject({ outflowCents: 0 });
});

it('uses exact schedule membership and preserves transfer topology without ordinary purchases', () => {
  const model = financePaymentDays(workspace({ recurring: [occurrence({ type: 'transfer' })], paymentItems: [{ id: 'schedule:power', name: 'Power', provider: 'Power', scheduleId: 'power' }] }), range([
    transaction('power', { scheduleId: 'power', amountCents: -9000 }),
    transaction('sent', { transferId: 'received' }),
    transaction('received', { scheduleId: null, transferId: 'sent', amountCents: 10000, accountId: 'savings' }),
    transaction('ordinary', { scheduleId: null, payee: 'Rent', amountCents: -8800 }),
  ]), '2026-09');
  expect(model.find(day => day.date === '2026-09-07')).toMatchObject({ outflowCents: 9000, transfers: 1, complete: true });
});

it('withholds incomplete recorded totals while keeping dates navigable', () => {
  const days = financePaymentDays(workspace(), range([], { truncated: true }), '2026-09');
  expect(days.find(day => day.date === '2026-09-07')?.complete).toBe(false);
  expect(days.find(day => day.date === '2026-09-22')?.complete).toBe(true);
  expect(financePaymentDays(workspace(), null, '2026-09').find(day => day.date === '2026-09-07')?.complete).toBe(false);
});

it('does not attribute an entire mixed purchase to a scheduled split child', () => {
  const days = financePaymentDays(workspace(), range([
    transaction('parent', { scheduleId: null, isParent: true, amountCents: -15000 }),
    transaction('rent-part', { parentId: 'parent', isChild: true, amountCents: -10000 }),
    transaction('other-part', { scheduleId: null, parentId: 'parent', isChild: true, amountCents: -5000 }),
  ]), '2026-09');
  expect(days.find(day => day.date === '2026-09-07')?.complete).toBe(false);
});
