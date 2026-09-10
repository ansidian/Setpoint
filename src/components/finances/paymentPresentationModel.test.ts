import { expect, it } from 'vitest';
import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceWorkspace, JournalRange, JournalTransaction, UtilityStatement } from '../../../shared/types/finances';
import { paymentCalendarPresentation, paymentPresentation } from './paymentPresentationModel';
const occurrence = (fields: Partial<ActualBillOccurrence> = {}): ActualBillOccurrence => ({ id: 'september', scheduleId: 'internet', name: 'Internet', payee: 'Provider', amount: 110, next_date: '2026-09-01', paid: true, type: 'bill', openActionDisabled: false, ...fields });
const transaction = (id: string, fields: Partial<JournalTransaction> = {}): JournalTransaction => ({ id, date: '2026-09-01', amountCents: -11000, payee: 'Provider', payeeId: 'provider', account: 'Checking', accountId: 'checking', category: '', notes: '', scheduleId: 'internet', transferId: null, parentId: null, isParent: false, isChild: false, cleared: true, reconciled: false, ...fields });
const range = (transactions: JournalTransaction[], fields: Partial<JournalRange> = {}): JournalRange => ({ start: '2025-10-01', end: '2026-09-09', transactions, relatives: [], truncated: false, ...fields });
const workspace = (occurrences: ActualBillOccurrence[] = [], recordedHistory?: JournalRange): FinanceWorkspace => ({ budgetId: 'budget', start: '2025-10-01', end: '2026-09-09', updatedAt: null, issues: [], truncated: false, recurring: [], recordedHistory, utilities: [{ identity: { id: 'internet', label: 'Internet', provider: 'Provider', budgetId: 'budget', payeeId: 'provider', scheduleIds: ['internet'], sourceSenders: [] }, statements: [], occurrences }] });
const statement = (fields: Partial<UtilityStatement> = {}): UtilityStatement => ({ id: 'statement', utilityId: 'internet', emailUid: 'email', subject: 'Internet bill', receivedAt: '2026-08-20', statementDate: '2026-08-20', dueDate: '2026-09-01', amountCents: 11000, amountKind: 'total_due', nothingDue: false, creditCents: null, newChargesCents: null, carriedBalanceCents: null, providerReference: 'reference', activity: null, paymentTransactionIds: [], paymentDate: null, recordedTotalCents: null, feeCents: null, issue: null, ...fields });

it('shows Internet paid from Actual without statements and keeps the next cycle distinct', () => {
  const data = workspace([occurrence({ paymentTransactionIds: ['paid'] }), occurrence({ id: 'october', next_date: '2026-10-01', paid: false })], range([transaction('paid')]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: 'Internet', status: 'paid', amountCents: 11000, amountKind: 'payment', dueDate: '2026-09-01', paymentDate: '2026-09-01', statements: [], nextOccurrence: { next_date: '2026-10-01' }, payments: [{ target: { view: 'journal', transactionId: 'paid', date: '2026-09-01' } }] });
  expect(paymentCalendarPresentation(rows, '2026-09').payments).toEqual([expect.objectContaining({ date: '2026-09-01', status: 'recorded', amountCents: 11000 })]);
});

it('keeps early and multiple recordings distinct from a due date across months', () => {
  const data = workspace([occurrence({ next_date: '2026-09-05', paymentTransactionIds: ['first', 'second'] })], range([transaction('first', { date: '2026-08-29', amountCents: -6000 }), transaction('second', { date: '2026-09-02', amountCents: -5000 })]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ dueDate: '2026-09-05', paymentDate: '2026-09-02', amountCents: 11000, payments: [{ id: 'second' }, { id: 'first' }] });
  expect(paymentCalendarPresentation(rows, '2026-09').payments.map(item => item.date)).toEqual(['2026-09-02']);
  expect(paymentPresentation(data, '2026-08').rows[0]).toMatchObject({ dueDate: '2026-09-05', status: 'paid' });
});

it('does not settle an unlinked bill from payee history, and does not claim unpaid when history fails', () => {
  const data = workspace([occurrence({ paid: false })], range([transaction('unlinked', { scheduleId: null })]));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows.map(row => row.status)).toEqual(['paid', 'scheduled']);
  expect(rows.find(row => row.status === 'scheduled')).toMatchObject({ payments: [], history: [{ id: 'unlinked' }] });
  expect(paymentPresentation(data, '2026-09', null)).toMatchObject({ historyComplete: false, rows: [{ status: 'scheduled', payments: [] }] });
  expect(paymentPresentation(data, '2026-09', range([], { truncated: true })).historyComplete).toBe(false);
});

it('retains an unconfirmed schedule claim without fabricating a payment', () => {
  const { rows } = paymentPresentation(workspace([occurrence()], range([])), '2026-09');
  expect(rows[0]).toMatchObject({ status: 'unknown', dueDate: null, scheduledDate: null, paymentDate: null, payments: [], amountKind: null, unconfirmedOccurrences: [{ paid: true, next_date: '2026-09-01' }] });
  expect(paymentCalendarPresentation(rows, '2026-09').payments).toEqual([]);
});

it('preserves multiple recurring cycles and distinguishes received and transferred amounts', () => {
  const data = workspace([], range([transaction('income', { amountCents: 11000 }), transaction('transfer', { date: '2026-09-08', transferId: 'pair' }), transaction('pair', { date: '2026-09-09', transferId: 'transfer', accountId: 'savings', amountCents: 11000, scheduleId: null, payeeId: null })]));
  data.utilities = [];
  data.recurring = [occurrence({ type: 'income', paymentTransactionIds: ['income'] }), occurrence({ id: 'second', next_date: '2026-09-08', type: 'transfer', paymentTransactionIds: ['transfer'] })];
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

it('merges only unambiguous same-date statements and occurrences and keeps amount provenance', () => {
  const data = workspace([occurrence({ paid: false })], range([]));
  data.utilities[0]!.statements = [statement(), statement({ id: 'duplicate-email' })];
  let rows = paymentPresentation(data, '2026-09').rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ amountKind: 'statement', statements: [{ id: 'statement' }, { id: 'duplicate-email' }], occurrence: { id: 'september' } });
  data.utilities[0]!.statements.push(statement({ id: 'competing', providerReference: 'other', amountCents: 5000 }));
  rows = paymentPresentation(data, '2026-09').rows;
  expect(rows).toHaveLength(3);
});

it('does not report missing past history for a future forecast month', () => {
  expect(paymentPresentation(workspace([], range([])), '2026-10').historyComplete).toBe(true);
});

it('shows a current nothing-due statement even without a due date', () => {
  const data = workspace([], range([]));
  data.utilities[0]!.statements = [statement({ nothingDue: true, dueDate: null, statementDate: '2026-09-01' })];
  expect(paymentPresentation(data, '2026-09').rows[0]).toMatchObject({ status: 'nothing_due' });
});

it('keeps utility identities visible without adding off-month recurring placeholders', () => {
  const data = workspace([], range([]));
  data.recurring = [occurrence({ scheduleId: 'annual', next_date: '2026-12-01', paid: false })];
  expect(paymentPresentation(data, '2026-09').rows).toEqual([expect.objectContaining({ utilityId: 'internet', status: 'unknown' })]);
});


it('keeps a deleted legacy paid occurrence as evidence beside one current Journal payment', () => {
  const data = workspace([occurrence({ id: 'legacy', next_date: '2026-09-04' })], range([transaction('current')]));
  data.recurring = data.utilities[0]!.occurrences;
  data.utilities = [];
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

it('preserves unconfirmed schedule evidence when history is incomplete or unavailable', () => {
  for (const history of [null, range([], { truncated: true }), range([], { start: '2026-09-05' })]) {
    const model = paymentPresentation(workspace([occurrence({ paymentTransactionIds: ['missing'] })]), '2026-09', history);
    expect(model).toMatchObject({ historyComplete: false, rows: [{ status: 'unknown', unconfirmedOccurrences: [{ paymentTransactionIds: ['missing'] }] }] });
  }
});

it('uses a corrected recording date only through its exact transaction identity', () => {
  const data = workspace([occurrence({ next_date: '2026-09-04', paymentTransactionIds: ['corrected'] })], range([transaction('corrected')]));
  expect(paymentPresentation(data, '2026-09').rows).toEqual([expect.objectContaining({ status: 'paid', dueDate: '2026-09-04', paymentDate: '2026-09-01', unconfirmedOccurrences: [] })]);
});
