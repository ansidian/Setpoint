import { describe, expect, it } from 'vitest';
import type { FinancialEmailPlan, FinancialTargetKind } from '../../../shared/types/bills';
import { completionValues, createCompletionDraft, enrichCompletionDraft } from './financialCompletionDraft';

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

  it('leaves unsupported entry types and unresolved target suggestions empty', () => {
    const unknown = plan();
    unknown.candidate = { type: 'transfer', event_kind: 'account_transfer_pending' };
    unknown.targets.account = { kind: 'account', status: 'unresolved', id: 'unverified-card', provenance: [] };
    unknown.targets.category = { kind: 'category', status: 'unresolved', id: 'unverified-category', provenance: [] };
    expect(createCompletionDraft(unknown).fields).toMatchObject({ kind: '', accountId: '', categoryId: '', amount: '', date: '' });
  });
});
