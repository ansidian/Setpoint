import { getDemoCorrection } from './financialCorrections';
import type { FinancialEmailPlan, FinancialPlanTarget } from '../../shared/types/bills';
import type { FinancialEventCompletionRequest } from '../../shared/types/financial-operations';
import type { CorrectionSnapshot, FinancialCorrectionDraft } from '../../shared/types/financial-corrections';
import { publishDemoFinanceSnapshot, announceDemoFinanceChange } from './financeProjection';
import type { FinancialActivity, FinancialWriteEvidence } from '../../shared/types/financial-activity';
import { getDemoSeed } from './store';
import { demoNotFound } from './apiHandler';

const createdAt = Date.now();
let completed: FinancialEventCompletionRequest | null = null;
let completionEvidence: FinancialWriteEvidence | null = null;
const target = (kind: FinancialPlanTarget['kind'], id?: string): FinancialPlanTarget => ({ kind, status: id ? 'resolved' : 'unresolved', id: id || null, provenance: [] });
export function demoCompletionPlan(): FinancialEmailPlan {
  const correction = getDemoCorrection({ owner: 'event', id: 'demo-event-review' });
  const result = correction?.effectiveResult as { entry?: FinancialCorrectionDraft & { payee?: string }; scheduleId?: string } | null;
  const effective = result?.entry;
  const entry = effective ? { kind: effective.type === 'payment' ? 'expense' as const : effective.type, amount: effective.amountCents / 100, date: effective.date, payee: effective.payee, accountId: effective.accountId, fromAccountId: effective.fromAccountId, toAccountId: effective.toAccountId, categoryId: effective.categoryId } : completed?.entry;
  return { version: 1, identity: { version: 1, status: 'resolved', key: 'demo-event-review' },
    candidate: { type: entry?.kind === 'transfer_schedule' ? 'transfer' : entry?.kind || 'expense', payee: entry?.payee || 'Fictional Market', amount: entry?.amount || 46.75, due_date: entry?.date || getDemoSeed().dateKey, currency: 'USD' },
    classification: { documentKind: 'one_time_transaction', eventKind: 'purchase', confidence: 1, reasons: [] },
    operation: { kind: completed ? 'no_write' : 'review', intended: entry?.kind === 'bill' ? 'create_schedule' : entry?.kind === 'transfer' ? 'create_transfer' : 'create_transaction', reasons: [] },
    targets: { account: target('account', entry?.accountId || 'demo-checking'), payee: { ...target('payee', effective?.payeeId || (completed ? 'demo-payee-completed-review' : undefined)), label: entry?.payee || 'Fictional Market' }, category: target('category', entry?.categoryId || undefined), fromAccount: target('from_account', entry?.fromAccountId), toAccount: target('to_account', entry?.toAccountId), schedule: target('schedule', result?.scheduleId || (entry?.kind === 'bill' ? 'demo-completed-schedule' : undefined)) },
    reconciliation: { status: completed ? entry?.kind === 'bill' ? 'already_scheduled' : 'already_recorded' : 'needs_review', reason: effective ? 'Correction verified in the fictional budget.' : completed ? 'Recorded in the fictional budget.' : 'Confirm the payment details.' },
    automation: { eligible: false, operationClass: 'one_time_expense', rollout: 'observe_only', gates: [], reasons: [] }, reviewReasons: [],
    workflow: { ...(correction ? { correction: { id:correction.id, state:correction.state, revision:correction.revision } } : {}), id: 'demo-event-review', state: completed ? 'settled' : 'needs_review', relatedEmails: 1, reason: null, nextAttemptAt: null,
      completion: { emailUid: 'demo-email-budget', documentRevision: completed ? 2 : 1, eventRevision: completed ? 2 : 1, canComplete: !completed } } };
}
export function completeDemoFinancialEvent(request: FinancialEventCompletionRequest): FinancialEmailPlan {
  if (request.emailUid !== 'demo-email-budget') return demoNotFound(request.emailUid);
  if (completed || request.documentRevision !== 1 || request.eventRevision !== 1) throw Object.assign(new Error('This fictional record changed. Refresh its current status.'), { status: 409 });
  if (!(request.entry.amount > 0) || !request.entry.date) throw new Error('Enter an amount and date.');
  const entry = request.entry;
  if (entry.kind === 'transfer_schedule') throw new Error('Fictional transfer schedules require recurrence setup and are unavailable here.');
  const seed = getDemoSeed();
  if (entry.kind === 'transfer' ? !entry.fromAccountId || !entry.toAccountId || entry.fromAccountId === entry.toAccountId : !entry.accountId) throw new Error('Choose the accounts for this record.');
  const payeeId = 'demo-payee-completed-review';
  seed.actualMetadata.payees.push({ id: payeeId, name: entry.payee || 'Fictional Market' });
  const before: CorrectionSnapshot = { budgetId: 'demo-budget', transactions: [], schedules: [], rules: [], dates: [],
    accounts: structuredClone(seed.actualMetadata.accounts), payees: structuredClone(seed.actualMetadata.payees), categories: seed.actualMetadata.categories.flatMap(group => structuredClone(group.categories)), scheduleNames: [] };
  const after = structuredClone(before);
  const date = Number(entry.date.replace(/-/g, ''));
  const amount = Math.round(entry.amount * 100);
  if (entry.kind === 'bill') {
    after.schedules = [{ id: 'demo-completed-schedule', name: entry.scheduleName || entry.payee || 'Fictional bill', rule: 'demo-completed-rule', tombstone: 0 }];
    after.rules = [{ id: 'demo-completed-rule', conditions: [{ field: 'amount', op: 'is', value: -amount }, { field: 'account', op: 'is', value: entry.accountId }, { field: 'payee', op: 'is', value: payeeId }, { field: 'date', op: 'is', value: entry.date }], actions: [{ op: 'set', field: 'category', value: entry.categoryId || null }] }];
    after.dates = [{ id: 'demo-completed-schedule-date', schedule_id: 'demo-completed-schedule', local_next_date: date, base_next_date: date }];
  } else {
    after.transactions = [{ id: 'demo-completed-review', acct: entry.kind === 'transfer' ? entry.fromAccountId : entry.accountId, description: payeeId, amount: entry.kind === 'income' ? amount : -amount, date, category: entry.kind === 'transfer' ? null : entry.categoryId || null, notes: entry.notes || '', transferred_id: entry.kind === 'transfer' ? 'demo-completed-counterpart' : null }];
    if (entry.kind === 'transfer') after.transactions.push({ ...after.transactions[0], id: 'demo-completed-counterpart', acct: entry.toAccountId, amount, transferred_id: 'demo-completed-review' });
  }
  completionEvidence = { budgetId: 'demo-budget', objects: [...after.transactions.map((row, index) => ({ kind: 'transaction' as const, id: row.id, role: index ? 'counterpart' as const : 'primary' as const, provenance: 'created' as const, beforeState: 'confirmed_absent' as const, before: null, after: row })), ...after.schedules.map(row => ({ kind: 'schedule' as const, id: row.id, role: 'primary' as const, provenance: 'created' as const, beforeState: 'confirmed_absent' as const, before: null, after: row }))] };
  publishDemoFinanceSnapshot(before, after);
  completed = structuredClone(request);
  announceDemoFinanceChange();
  return demoCompletionPlan();
}
export function demoReviewActivity(base: FinancialActivity): FinancialActivity {
  const plan = demoCompletionPlan();
  const reference = { owner: 'event' as const, id: 'demo-event-review' };
  const entry = completed?.entry;
  return { ...base, id: JSON.stringify(['event', reference.id]), reference, occurrences: [reference], source: 'managed', contexts: ['arrival'],
    emailUids: ['demo-email-budget'], subject: 'Your Fictional Market receipt', payee: entry?.payee || 'Fictional Market', amountCents: entry ? Math.round(entry.amount * 100) * (entry.kind === 'income' ? 1 : -1) : -4675,
    status: completed ? 'completed' : 'needs_attention', reason: plan.reconciliation.reason || '', actions: { complete: !completed, correct: !!completed, retry: false, inspect: true },
    completionPlan: plan, importItem: null, runs: [], targetBindings: [], sourceEvidence: [{ label: 'Fictional receipt', text: 'Fictional Market payment: $46.75. Confirm the account.' }],
    originalReceipts: completed ? [{ reference, revision: 2, capturedAt: createdAt, captureKind: 'settlement', outcome: 'added', input: entry, result: entry?.kind === 'bill' ? { scheduleId: 'demo-completed-schedule' } : { transactionId: 'demo-completed-review' }, evidence: structuredClone(completionEvidence) }] : [], effectiveResult: null };
}
