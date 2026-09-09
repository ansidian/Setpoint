import { expect, it } from 'vitest';
import type { JournalRange, JournalTransaction } from '../../../shared/types/finances';
import { financeActivityDays, financeMonthCells, financeMonthRange, shiftFinanceMonth } from './financeActivityModel';

const row = (id: string, fields: Partial<JournalTransaction> = {}): JournalTransaction => ({
  id, date: '2026-09-08', amountCents: -100, payee: 'Market', payeeId: 'p', account: 'Checking',
  accountId: 'a', category: 'Groceries', notes: '', scheduleId: null, transferId: null,
  parentId: null, isParent: false, isChild: false, cleared: false, reconciled: false, ...fields,
});
const range = (transactions: JournalTransaction[], fields: Partial<JournalRange> = {}): JournalRange => ({
  start: '2026-09-01', end: '2026-09-08', transactions, relatives: [], truncated: false, ...fields,
});

it('counts split purchases once, keeps signed flows separate, and excludes reciprocal transfers from flows', () => {
  const days = financeActivityDays(range([
    row('parent', { isParent: true, amountCents: -300 }),
    row('child1', { isChild: true, parentId: 'parent', amountCents: -100 }),
    row('child2', { isChild: true, parentId: 'parent', amountCents: -200 }),
    row('income', { amountCents: 420000 }),
    row('sent', { transferId: 'received', amountCents: -25000 }),
    row('received', { transferId: 'sent', accountId: 'b', amountCents: 25000 }),
  ]));
  expect(days[0]).toMatchObject({ date: '2026-09-08', incomeCents: 420000, outflowCents: 300, transfers: 1, complete: true });
  expect(days[0]!.entries).toHaveLength(3);
  expect(days[1]).toMatchObject({ date: '2026-09-07', incomeCents: 0, outflowCents: 0, entries: [], complete: true });
});

it('keeps cross-date transfer markers on their own dates and excludes outside-range relatives', () => {
  const sent = row('sent', { date: '2026-09-01', transferId: 'received' });
  const received = row('received', { date: '2026-09-02', transferId: 'sent', amountCents: 100, accountId: 'b' });
  const days = financeActivityDays(range([sent, received], { relatives: [row('outside', { date: '2026-08-31', amountCents: 500000 })] }));
  expect(days.filter(day => day.transfers).map(day => [day.date, day.transfers, day.incomeCents, day.outflowCents])).toEqual([
    ['2026-09-02', 1, 0, 0], ['2026-09-01', 1, 0, 0],
  ]);
  expect(days).toHaveLength(8);
});

it('marks truncated and incomplete evidence without converting unresolved transfers into spending', () => {
  const incomplete = financeActivityDays(range([row('missing', { transferId: 'absent' })]));
  expect(incomplete[0]).toMatchObject({ complete: false, transfers: 1, incomeCents: 0, outflowCents: 0 });
  const truncated = financeActivityDays(range([row('known')], { truncated: true }));
  expect(truncated.every(day => !day.complete)).toBe(true);
  expect(truncated[1]!.entries).toEqual([]);
  const split = financeActivityDays(range([row('parent', { isParent: true, amountCents: -500 })]));
  expect(split[0]!.complete).toBe(false);
});

it('recognizes transfer payees without paired rows and keeps ordinary credits as income', () => {
  const days = financeActivityDays(range([
    row('card-payment', { amountCents:122903,transferAccountId:'savings',transferAccount:'Savings' }),
    row('withdrawal', { amountCents:-2500,transferAccountId:'card',transferAccount:'Credit card' }),
    row('cashback', { amountCents:1250 }),
  ]));
  expect(days[0]).toMatchObject({incomeCents:1250,outflowCents:0,transfers:2,complete:true});
  expect(days[0]?.entries.find(entry=>entry.id==='card-payment')).toMatchObject({kind:'received',counterpart:null,incomplete:false});
  expect(days[0]?.entries.find(entry=>entry.id==='withdrawal')).toMatchObject({kind:'sent',counterpart:null,incomplete:false});
});

it('uses stable six-week grids and correct leap/year boundaries, ending current reads at today', () => {
  expect(financeMonthRange('2024-02', '2026-09-08')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  expect(financeMonthRange('2026-09', '2026-09-08')).toEqual({ start: '2026-09-01', end: '2026-09-08' });
  expect(shiftFinanceMonth('2026-01', -1)).toBe('2025-12');
  const cells = financeMonthCells('2026-08');
  expect(cells).toHaveLength(42);
  expect(cells[0]).toBe('2026-07-26');
  expect(cells[41]).toBe('2026-09-05');
});

it('withholds cash-flow totals for mixed split transfers while retaining their rows', () => {
  const days = financeActivityDays(range([
    row('parent', { isParent: true, amountCents: -300 }),
    row('purchase', { parentId: 'parent', isChild: true, amountCents: -100 }),
    row('transfer', { parentId: 'parent', isChild: true, amountCents: -200, transferId: 'other' }),
    row('other', { transferId: 'transfer', accountId: 'b', amountCents: 200 }),
  ]));
  expect(days[0]!.complete).toBe(false);
  expect(days[0]!.entries.some(entry => entry.ids.includes('purchase'))).toBe(true);
});

it('keeps exact in-range deep links reachable under truncation, including split children', () => {
  const parent = row('parent', { date: '2026-09-01', isParent: true, amountCents: -300 });
  const child = row('child', { date: '2026-09-01', parentId: 'parent', isChild: true, amountCents: -300 });
  const partial = range([row('newest')], { truncated: true, relatives: [parent, child, row('unrequested', { date: '2026-09-02' }), row('outside', { date: '2026-08-31' })] });
  const days = financeActivityDays(partial, 'child');
  expect(days.flatMap(day => day.entries).map(entry => entry.id)).toEqual(['newest', 'parent']);
  expect(days.find(day => day.date === '2026-09-01')).toMatchObject({ complete: false, entries: [{ ids: ['parent', 'child'] }] });
  expect(financeActivityDays(partial, 'outside').flatMap(day => day.entries).map(entry => entry.id)).toEqual(['newest']);
});
