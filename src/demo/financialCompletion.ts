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
  const transfer = entry?.kind === 'transfer' || entry?.kind === 'transfer_schedule';
  const scheduled = entry?.kind === 'bill' || entry?.kind === 'transfer_schedule';
  const eventKind = entry?.kind === 'bill' ? 'bill_issued' : entry?.kind === 'transfer_schedule' ? 'payment_scheduled' : entry?.kind === 'transfer' ? 'account_transfer_completed' : entry?.kind === 'income' ? 'payment_completed' : 'purchase';
  const payee = transfer ? undefined : entry?.payee || 'Fictional Market';
  return { version: 1, identity: { version: 1, status: 'resolved', key: 'demo-event-review' },
    candidate: { type: entry?.kind === 'transfer_schedule' ? 'transfer' : entry?.kind || 'expense', payee, event_kind: eventKind, amount_kind: entry?.kind === 'bill' ? 'total_due' : transfer ? 'payment_amount' : 'transaction_amount', amount: entry?.amount || 46.75, due_date: entry?.date || getDemoSeed().dateKey, currency: 'USD' },
    classification: { documentKind: entry?.kind === 'bill' ? 'utility_statement' : entry?.kind === 'income' ? 'income' : 'one_time_transaction', eventKind, confidence: 1, reasons: [] },
    operation: { kind: completed ? 'no_write' : 'review', intended: entry?.kind === 'bill' ? 'create_schedule' : entry?.kind === 'transfer' ? 'create_transfer' : entry?.kind === 'transfer_schedule' ? 'create_transfer_schedule' : 'create_transaction', reasons: [] },
    targets: { account: target('account', transfer ? undefined : entry?.accountId || 'demo-checking'), payee: { ...target('payee', transfer ? undefined : effective?.payeeId || (completed ? 'demo-payee-completed-review' : undefined)), label: payee }, category: target('category', entry?.categoryId || undefined), fromAccount: target('from_account', entry?.fromAccountId), toAccount: target('to_account', entry?.toAccountId), schedule: target('schedule', result?.scheduleId || (scheduled ? 'demo-completed-schedule' : undefined)) },
    reconciliation: { status: completed ? scheduled ? 'already_scheduled' : 'already_recorded' : 'needs_review', reason: effective ? 'Correction verified in the fictional budget.' : completed ? scheduled ? 'Scheduled in the fictional budget.' : 'Recorded in the fictional budget.' : 'Confirm the payment details.' },
    automation: { eligible: false, operationClass: entry?.kind === 'bill' ? 'utility_schedule' : entry?.kind === 'transfer_schedule' ? 'transfer_schedule' : entry?.kind === 'transfer' ? 'completed_transfer' : entry?.kind === 'income' ? 'income' : 'one_time_expense', rollout: 'observe_only', gates: [], reasons: [] }, reviewReasons: [],
    workflow: { ...(correction ? { correction: { id:correction.id, state:correction.state, revision:correction.revision } } : {}), id: 'demo-event-review', state: completed ? 'settled' : 'needs_review', relatedEmails: 1, reason: null, nextAttemptAt: null,
      completion: { emailUid: 'demo-email-budget', documentRevision: completed ? 2 : 1, eventRevision: completed ? 2 : 1, canComplete: !completed } } };
}
export function completeDemoFinancialEvent(request: FinancialEventCompletionRequest): FinancialEmailPlan {
  if (request.emailUid !== 'demo-email-budget') return demoNotFound(request.emailUid);
  if (completed || request.documentRevision !== 1 || request.eventRevision !== 1) throw Object.assign(new Error('This fictional record changed. Refresh its current status.'), { status: 409 });
  if (!(request.entry.amount > 0) || !request.entry.date) throw new Error('Enter an amount and date.');
  const entry = request.entry;
  const transfer = entry.kind === 'transfer' || entry.kind === 'transfer_schedule';
  const seed = getDemoSeed();
  if (transfer ? !entry.fromAccountId || !entry.toAccountId || entry.fromAccountId === entry.toAccountId : !entry.accountId) throw new Error('Choose the accounts for this record.');
  if (entry.kind === 'transfer_schedule' && entry.date <= seed.dateKey) throw new Error('The payment date has arrived or passed. This notice does not confirm a completed transfer.');
  const payeeId = entry.kind === 'transfer_schedule' ? `demo-transfer-payee-${entry.fromAccountId}` : 'demo-payee-completed-review';
  const completionPayee = entry.kind === 'transfer_schedule'
    ? { id: payeeId, name: seed.actualMetadata.accounts.find(account => account.id === entry.fromAccountId)?.name || 'Demo account', transfer_acct: entry.fromAccountId }
    : { id: payeeId, name: entry.payee || 'Fictional Market' };
  if (!seed.actualMetadata.payees.some(payee => payee.id === payeeId)) seed.actualMetadata.payees.push(completionPayee);
  const before: CorrectionSnapshot = { budgetId: 'demo-budget', transactions: [], schedules: [], rules: [], dates: [],
    accounts: structuredClone(seed.actualMetadata.accounts), payees: structuredClone(seed.actualMetadata.payees), categories: seed.actualMetadata.categories.flatMap(group => structuredClone(group.categories)), scheduleNames: [] };
  const after = structuredClone(before);
  const date = Number(entry.date.replace(/-/g, ''));
  const amount = Math.round(entry.amount * 100);
  if (entry.kind === 'bill' || entry.kind === 'transfer_schedule') {
    after.schedules = [{ id: 'demo-completed-schedule', name: entry.scheduleName || entry.payee || 'Payment', rule: 'demo-completed-rule', completed: false, posts_transaction: false, tombstone: 0 }];
    after.rules = [{ id: 'demo-completed-rule', conditions: [{ field: 'amount', op: 'is', value: transfer ? amount : -amount }, { field: 'account', op: 'is', value: transfer ? entry.toAccountId : entry.accountId }, { field: 'payee', op: 'is', value: payeeId }, { field: 'date', op: 'is', value: entry.date }], actions: [{ op: 'link-schedule', value: 'demo-completed-schedule' }, ...(transfer ? [] : [{ op: 'set', field: 'category', value: entry.categoryId || null }])] }];
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
    originalReceipts: completed ? [{ reference, revision: 2, capturedAt: createdAt, captureKind: 'settlement', outcome: 'added', input: entry, result: entry?.kind === 'bill' || entry?.kind === 'transfer_schedule' ? { scheduleId: 'demo-completed-schedule' } : { transactionId: 'demo-completed-review' }, evidence: structuredClone(completionEvidence) }] : [], effectiveResult: null };
}
