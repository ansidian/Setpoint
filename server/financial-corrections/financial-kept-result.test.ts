import { describe, expect, it } from 'vitest';
import { buildKeptFinancialResult } from '../../shared/financial-kept-result.ts';
import type { CorrectionSnapshot, FinancialCorrectionPreview } from '../../shared/types/financial-corrections.ts';

function fixture() {
  const snapshot: CorrectionSnapshot = { budgetId: 'budget', transactions: [{ id: 'tx', acct: 'checking', amount: -1800, date: 20260903, description: 'shop', category: 'food', notes: 'Observed note', tombstone: 0 }], schedules: [], rules: [], dates: [],
    accounts: [{ id: 'checking' }, { id: 'savings' }], payees: [{ id: 'shop', name: 'Actual shop' }, { id: 'to-savings', transfer_acct: 'savings' }, { id: 'to-checking', transfer_acct: 'checking' }], categories: [{ id: 'food' }], scheduleNames: [] };
  const preview: FinancialCorrectionPreview = { id: 'correction', reference: { owner: 'event', id: 'event' }, activityId: 'activity', budgetId: 'budget', sourceRevision: 'one', predecessorId: null,
    draft: { type: 'income', amountCents: 99999, date: '2099-01-01', accountId: 'invented', notes: 'Unapplied note', name: 'Unapplied name' }, originalReceipts: [],
    evidence: { budgetId: 'budget', objects: [{ kind: 'transaction', id: 'tx', role: 'primary', provenance: 'created', beforeState: 'confirmed_absent', before: null, after: { id: 'tx', amount: -1000 } }] },
    snapshot: structuredClone(snapshot), targets: { transactionIds: ['tx'], scheduleIds: [], ruleIds: [] }, steps: [], createdAt: 1 };
  return { snapshot, preview };
}
function scheduled() {
  const { snapshot, preview } = fixture();
  snapshot.transactions = [];
  snapshot.schedules = [{ id: 'schedule', name: 'Observed schedule', rule: 'rule', posts_transaction: 0 }];
  snapshot.rules = [{ id: 'rule', conditions: JSON.stringify([{ field: 'date', op: 'is', value: { frequency: 'monthly', start: '2026-10-03' } }, { field: 'acct', op: 'is', value: 'checking' }, { field: 'amount', op: 'is', value: -2400 }, { field: 'description', op: 'is', value: 'shop' }]), actions: JSON.stringify([{ op: 'link-schedule', value: 'schedule' }, { op: 'set', field: 'notes', value: 'Observed schedule note', options: {} }, { op: 'set', field: 'category', value: 'food' }]) }];
  snapshot.dates = [{ id: 'next', schedule_id: 'schedule', base_next_date: 20261003, local_next_date: 20261103, base_next_date_ts: 1, local_next_date_ts: 2 }];
  preview.evidence.objects = [{ kind: 'schedule', id: 'schedule', role: 'primary', provenance: 'updated', beforeState: 'captured', before: { id: 'schedule', name: 'Original name' }, after: snapshot.schedules[0]! }];
  return { snapshot, preview };
}
describe('keeping an observed Actual result', () => {
  it('uses current ledger facts, never unapplied draft values, and preserves provenance', () => {
    const { snapshot, preview } = fixture();
    const result = buildKeptFinancialResult(preview, snapshot);
    expect(result).toMatchObject({ outcome: 'kept', resolution: 'kept_actual', transactionId: 'tx', entry: { type: 'payment', kind: 'expense', amountCents: 1800, signedAmountCents: -1800, amount: 18, date: '2026-09-03', accountId: 'checking', payee: 'Actual shop', categoryId: 'food', notes: 'Observed note' } });
    expect(result.evidence.objects).toEqual([{ ...preview.evidence.objects[0], after: snapshot.transactions[0] }]);
    expect(result.entry?.name).toBeUndefined();
    result.snapshot.transactions[0]!.amount = 1;
    expect(snapshot.transactions[0]!.amount).toBe(-1800);
  });
  it('derives income from the observed sign and transfers from a reciprocal pair', () => {
    const { snapshot, preview } = fixture();
    snapshot.transactions[0]!.amount = 1200;
    expect(buildKeptFinancialResult(preview, snapshot).entry).toMatchObject({ type: 'income', amount: 12, signedAmountCents: 1200 });
    snapshot.transactions = [{ id: 'tx', acct: 'savings', amount: 1200, date: 20260903, transferred_id: 'peer', description: 'to-checking' }, { id: 'peer', acct: 'checking', amount: -1200, date: 20260903, transferred_id: 'tx', description: 'to-savings' }];
    expect(buildKeptFinancialResult(preview, snapshot).entry).toMatchObject({ type: 'transfer', fromAccountId: 'checking', toAccountId: 'savings', signedAmountCents: 1200 });
    snapshot.transactions[1]!.transferred_id = 'unrelated';
    const broken = buildKeptFinancialResult(preview, snapshot);
    expect(broken.entry).toBeUndefined();
    expect(broken.transactionId).toBe('tx');
    expect(broken.snapshot.transactions).toHaveLength(2);
  });
  it('derives bill facts from observed raw rules and the effective next date', () => {
    const { snapshot, preview } = scheduled();
    expect(buildKeptFinancialResult(preview, snapshot).entry).toMatchObject({ type: 'bill', amountCents: 2400, signedAmountCents: -2400, date: '2026-10-03', accountId: 'checking', name: 'Observed schedule', notes: 'Observed schedule note', categoryId: 'food', payee: 'Actual shop' });
    snapshot.dates[0]!.local_next_date_ts = 1;
    expect(buildKeptFinancialResult(preview, snapshot).entry?.date).toBe('2026-11-03');
  });
  it.each([2400, -2400])('derives scheduled transfer accounts from observed orientation %s', amount => {
    const { snapshot, preview } = scheduled();
    snapshot.rules[0]!.conditions = [{ field: 'date', op: 'is', value: '2026-10-03' }, { field: 'account', op: 'is', value: 'checking' }, { field: 'amount', op: 'is', value: amount }, { field: 'payee', op: 'is', value: 'to-savings' }];
    expect(buildKeptFinancialResult(preview, snapshot).entry).toMatchObject({ type: 'transfer_schedule', fromAccountId: amount > 0 ? 'savings' : 'checking', toAccountId: amount > 0 ? 'checking' : 'savings', amountCents: 2400 });
  });
  it('uses an exact intended replacement when the original is gone without inventing creation provenance', () => {
    const { snapshot, preview } = scheduled();
    const original = fixture().preview.evidence.objects[0]!;
    preview.evidence.objects = [original];
    preview.steps = [{ id: 'step', command: 'schedule/create', payload: {}, targets: preview.targets, before: preview.snapshot, after: { schedule: { id: 'schedule', name: 'Unapplied name' } } }];
    const result = buildKeptFinancialResult(preview, snapshot);
    expect(result.entry?.name).toBe('Observed schedule');
    expect(result.evidence.objects.find(object => object.role === 'primary')).toMatchObject({ kind: 'schedule', id: 'schedule', provenance: 'unknown' });
    expect(result.evidence.objects.filter(object => object.role === 'primary')).toHaveLength(1);
  });
  it('keeps absent or ambiguous observations inspectable without guessed values', () => {
    const { snapshot, preview } = fixture();
    snapshot.transactions = [];
    expect(buildKeptFinancialResult(preview, snapshot)).toMatchObject({ entry: undefined, evidence: { objects: [{ ...preview.evidence.objects[0], after: null }] } });
    snapshot.transactions = [{ id: 'one', amount: 1000 }, { id: 'two', amount: -3000 }];
    preview.steps = [{ id: 'step', command: 'transactions-batch-update', payload: {}, targets: preview.targets, before: preview.snapshot, after: { transactions: [{ id: 'one' }, { id: 'two' }] } }];
    const ambiguous = buildKeptFinancialResult(preview, snapshot);
    expect(ambiguous.entry).toBeUndefined();
    expect(ambiguous.transactionId).toBeUndefined();
    expect(ambiguous.evidence.objects.filter(object => object.role === 'primary')).toEqual([{ ...preview.evidence.objects[0], after: null }]);
  });
  it('does not summarize malformed, duplicated, or overridden schedule rules', () => {
    const { snapshot, preview } = scheduled();
    snapshot.rules[0]!.conditions = '{broken';
    expect(buildKeptFinancialResult(preview, snapshot).entry).toBeUndefined();
    Object.assign(snapshot, scheduled().snapshot);
    snapshot.dates.push({ ...snapshot.dates[0]!, id: 'duplicate-date' });
    expect(buildKeptFinancialResult(preview, snapshot).entry).toBeUndefined();
    Object.assign(snapshot, scheduled().snapshot);
    snapshot.rules[0]!.actions = [{ op: 'link-schedule', value: 'schedule' }, { op: 'set', field: 'amount', value: -9900 }];
    expect(buildKeptFinancialResult(preview, snapshot).entry).toBeUndefined();
  });
});
