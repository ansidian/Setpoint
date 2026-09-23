import { describe, expect, it } from 'vitest';
import type { FinancialEmailPlan, FinancialTargetKind } from '../../../shared/types/bills';
import { completionAmount, completionSplitBalance, distributeRemainingSplits, editCompletionDraft, completionValues, createCompletionDraft, enrichCompletionDraft } from './financialCompletionDraft';

function plan(): FinancialEmailPlan {
  const target = (kind: FinancialTargetKind) => ({ kind, status: 'not_applicable' as const, provenance: [] });
  return { version: 1, identity: { version: 1, status: 'resolved', key: 'receipt' }, candidate: {},
    classification: { documentKind: 'informational', eventKind: null, confidence: null, reasons: [] },
    operation: { intended: null, kind: 'review', reasons: [] }, targets: {
      account: target('account'), fromAccount: target('from_account'), toAccount: target('to_account'),
      payee: target('payee'), category: target('category'), schedule: target('schedule'),
    }, reconciliation: { status: 'not_checked', disposition: 'review' }, reviewReasons: [],
    automation: { eligible: false, operationClass: 'unsupported', rollout: 'observe_only', gates: [], reasons: [] },
    workflow: { id: 'receipt', state: 'needs_review', relatedEmails: 1, reason: 'Review details', nextAttemptAt: null,
      completion: { emailUid: 'receipt', documentRevision: 1, eventRevision: 1, canComplete: true } } };

}

describe('financial completion draft policy', () => {
  it('prepares a statement for payment scheduling while its financial plan is still pending', () => {
    const statement = plan();
    statement.candidate = { type: 'transfer', event_kind: 'statement_issued', amount: 207.43, due_date: '2026-10-05' };
    expect(createCompletionDraft(statement).fields).toMatchObject({ kind: 'transfer_schedule', amount: '207.43', date: '2026-10-05' });
  });

  it('keeps enrichment clean without changing the reviewed source version', () => {
    const initial = plan();
    const draft = createCompletionDraft(initial);
    const enriched = plan();
    enriched.candidate = { type: 'expense', amount: 10, due_date: '2026-09-10', payee: 'Merchant' };
    enriched.targets.account = { kind: 'account', status: 'resolved', id: 'card', provenance: [] };
    const next = enrichCompletionDraft(draft, enriched);
    expect(next.fields).toMatchObject({ kind: 'expense', amount: '10', accountId: 'card', payee: 'Merchant' });
    expect(completionValues(next.fields)).toBe(completionValues(next.baseline));
    expect(next.revision).toEqual(draft.revision);
  });

  it('preserves edited order allocations during enrichment and keeps an independent total in exact cents', () => {
    const source = plan();
    source.candidate = { type: 'expense', amount: null, order_items: [
      { reference: 'order-one', amount: 10.97, currency: 'USD' }, { reference: 'order-two', amount: 113.61, currency: 'USD' },
      { reference: 'order-three', amount: 14.35, currency: 'USD' },
    ] };
    const draft = createCompletionDraft(source);
    expect(completionAmount(draft.fields)).toBe(13893);
    const edited = editCompletionDraft(draft, 'splits', draft.fields.splits.map((split, index) => index ? split : { ...split, amount: '20.01' }));
    const enriched = enrichCompletionDraft(edited, source);
    expect(completionAmount(enriched.fields)).toBe(13893);
    expect(completionSplitBalance(enriched.fields)).toBe(-904);
    expect(completionValues(enriched.fields)).not.toBe(completionValues(enriched.baseline));
    expect(enrichCompletionDraft(draft, source)).toBe(draft);
    expect(completionSplitBalance({ ...edited.fields, splits: [{ amount: '4.001', notes: '', categoryId: '' }] })).toBeNull();
  });

  it('reopens confirmed allocations instead of reverting to extracted order amounts', () => {
    const source = plan();
    source.candidate = { type: 'expense', amount: 100, order_items: [{ reference: 'old', amount: 25, currency: 'USD' }] };
    source.workflow!.completion!.splits = [{ amount: 37.5, categoryId: 'food', notes: 'One' }, { amount: 62.5, notes: 'Two' }];
    const fields = createCompletionDraft(source).fields;
    expect(fields.splits).toEqual([{ amount: '37.5', categoryId: 'food', notes: 'One' }, { amount: '62.5', categoryId: '', notes: 'Two' }]);
    expect(completionSplitBalance(fields)).toBe(0);
  });

  it('shows the unallocated balance and adds it evenly without losing entered allocations or cents', () => {
    const fields = { ...createCompletionDraft(plan()).fields, kind: 'expense' as const, amount: '100',
      splits: [{ amount: '25', categoryId: 'food', notes: 'First' }, { amount: '50', categoryId: '', notes: 'Second' }] };
    expect(completionSplitBalance(fields)).toBe(2500);
    const distributed = distributeRemainingSplits(fields)!;
    expect(distributed).toEqual([{ ...fields.splits[0], amount: '37.50' }, { ...fields.splits[1], amount: '62.50' }]);
    expect(completionSplitBalance({ ...fields, splits: distributed })).toBe(0);
    expect(distributeRemainingSplits({ ...fields, amount: '100.01' })?.map(split => split.amount)).toEqual(['37.51', '62.50']);
    expect(distributeRemainingSplits({ ...fields, amount: '50' })).toBeNull();
    expect(completionSplitBalance({ ...fields, amount: '50' })).toBe(-2500);
    const empty = { ...fields, amount: '0.01', splits: fields.splits.map(split => ({ ...split, amount: '' })) };
    expect(distributeRemainingSplits(empty)).toBeNull();
    expect(distributeRemainingSplits({ ...empty, amount: '0.03' })?.map(split => split.amount)).toEqual(['0.02', '0.01']);
  });

  it('leaves unsupported entry types and unresolved target suggestions empty', () => {
    const unknown = plan();
    unknown.candidate = { type: 'transfer', event_kind: 'account_transfer_pending' };
    unknown.targets.account = { kind: 'account', status: 'unresolved', id: 'unverified-card', provenance: [] };
    unknown.targets.category = { kind: 'category', status: 'unresolved', id: 'unverified-category', provenance: [] };
    expect(createCompletionDraft(unknown).fields).toMatchObject({ kind: '', accountId: '', categoryId: '', amount: '', date: '' });
  });
});
