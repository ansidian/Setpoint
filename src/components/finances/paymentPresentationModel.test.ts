import { expect, it } from 'vitest';
import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceWorkspace, JournalRange, JournalTransaction, RecurringStatement, UtilityStatement } from '../../../shared/types/finances';
import { paymentCalendarPresentation, paymentPresentation } from './paymentPresentationModel';
import { monthlyPaymentAmounts } from './monthlyPaymentModel';
const occurrence = (fields: Partial<ActualBillOccurrence> = {}): ActualBillOccurrence => ({ id: 'september', scheduleId: 'internet', name: 'Internet', payee: 'Provider', amount: 110, next_date: '2026-09-01', paid: true, type: 'bill', openActionDisabled: false, ...fields });
const transaction = (id: string, fields: Partial<JournalTransaction> = {}): JournalTransaction => ({ id, date: '2026-09-01', amountCents: -11000, payee: 'Provider', payeeId: 'provider', account: 'Checking', accountId: 'checking', category: '', notes: '', scheduleId: 'internet', transferId: null, parentId: null, isParent: false, isChild: false, cleared: true, reconciled: false, ...fields });
const range = (transactions: JournalTransaction[], fields: Partial<JournalRange> = {}): JournalRange => ({ start: '2025-10-01', end: '2026-09-09', transactions, relatives: [], truncated: false, ...fields });
const workspace = (occurrences: ActualBillOccurrence[] = [], recordedHistory?: JournalRange): FinanceWorkspace => ({ budgetId: 'budget', start: '2025-10-01', end: '2026-09-09', updatedAt: null, issues: [], truncated: false, recurring: [], recordedHistory, utilities: [{ identity: { id: 'internet', label: 'Internet', provider: 'Provider', budgetId: 'budget', payeeId: 'provider', scheduleIds: ['internet'], sourceSenders: [] }, statements: [], occurrences }] });
const statement = (fields: Partial<UtilityStatement> = {}): UtilityStatement => ({ id: 'statement', utilityId: 'internet', emailUid: 'email', subject: 'Internet bill', receivedAt: '2026-08-20', statementDate: '2026-08-20', dueDate: '2026-09-01', amountCents: 11000, amountKind: 'total_due', nothingDue: false, creditCents: null, newChargesCents: null, carriedBalanceCents: null, providerReference: 'reference', activity: null, paymentTransactionIds: [], paymentDate: null, recordedTotalCents: null, feeCents: null, issue: null, ...fields });
const cardStatement = (fields: Partial<RecurringStatement> = {}): RecurringStatement => ({
  id: 'card-statement', scheduleId: 'card', budgetId: 'budget', emailUid: 'card-email', subject: 'Card statement',
  receivedAt: '2026-09-03', statementDate: '2026-09-02', dueDate: '2026-09-20', amountCents: 80000, amountKind: 'statement_balance',
  nothingDue: false, creditCents: null, newChargesCents: null, carriedBalanceCents: null, providerReference: null,
  activity: { owner: 'event', id: 'card-event' }, paymentTransactionIds: [], paymentDate: null, recordedTotalCents: null, feeCents: null, issue: null, ...fields,
});
const cardOccurrence = (fields: Partial<ActualBillOccurrence> = {}) => occurrence({
  id: 'card-september', scheduleId: 'card', name: 'Card payment', payee: 'Card account', type: 'transfer',
  amount: 200, next_date: '2026-09-18', paid: false, ...fields,
});
const cardTransfer = (id: string, date: string, amountCents: number) => [
  transaction(`${id}-out`, { date, scheduleId: 'card', amountCents: -amountCents, transferId: `${id}-in` }),
  transaction(`${id}-in`, { date, scheduleId: null, accountId: 'card', account: 'Card account', amountCents, transferId: `${id}-out` }),
];
const cardWorkspace = (occurrences = [cardOccurrence()], records: JournalTransaction[] = [], statements = [cardStatement()]): FinanceWorkspace => ({
  ...workspace([], range(records)), utilities: [], recurring: occurrences, recurringStatements: statements,
  paymentItems: [{ id: 'schedule:card', name: 'Card payment', provider: 'Card account', kind: 'credit_card', scheduleId: 'card' }],
});

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

it('shows a current nothing-due statement even without a due date', () => {
  const data = workspace([], range([]));
  data.utilities[0]!.statements = [statement({ nothingDue: true, dueDate: null, statementDate: '2026-09-01' })];
  expect(paymentPresentation(data, '2026-09').rows[0]).toMatchObject({ status: 'nothing_due' });
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

it('keeps a card statement balance and deadline distinct from a partial recorded payment and the next transfer', () => {
  const data = cardWorkspace([cardOccurrence()], cardTransfer('partial', '2026-09-02', 20000));
  const { rows } = paymentPresentation(data, '2026-09');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ isCreditCard: true, status: 'statement', amountKind: 'statement', amountCents: 80000,
    dueDate: '2026-09-20', scheduledDate: '2026-09-18', paymentDate: null,
    occurrence: { next_date: '2026-09-18', amount: 200 }, payments: [{ date: '2026-09-02', amountCents: 20000 }],
    statements: [{ emailUid: 'card-email', activity: { owner: 'event', id: 'card-event' } }] });
  expect(rows[0]!.payments[0]!.ids).toEqual(expect.arrayContaining(['partial-out', 'partial-in']));
  const calendar = paymentCalendarPresentation(rows, '2026-09');
  expect(calendar.payments.filter(item => item.status === 'recorded'))
    .toEqual([expect.objectContaining({ date: '2026-09-02', amountCents: 20000, direction: 'transfer' })]);
  expect(calendar.payments).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 'statement', rowId: rows[0]!.id, date: '2026-09-20', amountCents: 80000 }),
    expect.objectContaining({ status: 'scheduled', rowId: rows[0]!.id, date: '2026-09-18', amountCents: 20000 }),
  ]));
  expect(calendar.scheduledDays).toEqual([{ date: '2026-09-18', count: 1, amountCents: 20000 }]);
});

it('counts reciprocal card transfer pairs once across rows, the calendar, and monthly history', () => {
  const data = cardWorkspace([cardOccurrence({ paid: true, paymentTransactionIds: ['first-out', 'first-in'] })], [
    ...cardTransfer('first', '2026-09-02', 20000), ...cardTransfer('second', '2026-09-08', 15000),
  ]);
  const row = paymentPresentation(data, '2026-09').rows[0]!;
  expect(row).toMatchObject({ status: 'statement', amountCents: 80000, amountKind: 'statement', paymentDate: null });
  expect(row.payments.map(payment => payment.amountCents)).toEqual([15000, 20000]);
  expect(paymentCalendarPresentation([row], '2026-09').payments.filter(item => item.status === 'recorded')).toHaveLength(2);
  const september = monthlyPaymentAmounts(row.history, row.statementHistory, '2026-09')[11]!;
  expect(september).toMatchObject({ amountCents: 35000, paymentCount: 2, statements: [cardStatement()] });
  expect(september.payments.every(payment => payment.statements.length === 0)).toBe(true);
});

it('keeps original card sources available in their months without changing Actual monthly payment totals', () => {
  const augustSource = cardStatement({ id: 'august-statement', emailUid: 'august-email', receivedAt: '2026-08-03',
    statementDate: '2026-08-02', dueDate: '2026-08-20', amountCents: 70000 });
  const data = cardWorkspace([cardOccurrence()], cardTransfer('august', '2026-08-18', 10000), [cardStatement(), augustSource]);
  const row = paymentPresentation(data, '2026-09').rows[0]!;
  expect(row.statements).toEqual([cardStatement()]);
  expect(row.statementHistory).toEqual([cardStatement(), augustSource]);
  expect(monthlyPaymentAmounts(row.history, row.statementHistory, '2026-09').slice(-2)).toMatchObject([
    { month: '2026-08', amountCents: 10000, paymentCount: 1, statements: [augustSource] },
    { month: '2026-09', amountCents: null, paymentCount: 0, statements: [cardStatement()] },
  ]);
});

it('preserves statement-only and nothing-due card history without inventing a scheduled transfer', () => {
  const source = cardStatement({ nothingDue: true, dueDate: null, amountCents: 0, creditCents: 29 });
  const row = paymentPresentation(cardWorkspace([], [], [source]), '2026-09').rows[0]!;
  expect(row).toMatchObject({ status: 'nothing_due', amountCents: 0, dueDate: null, scheduledDate: null, payments: [],
    statements: [source], target: { view: 'schedule', scheduleId: 'card' } });
  expect(monthlyPaymentAmounts(row.history, row.statementHistory, '2026-09')[11])
    .toMatchObject({ amountCents: null, paymentCount: 0, statements: [source] });
  expect(paymentCalendarPresentation([row], '2026-09').payments).toEqual([]);
});

it('keeps an unavailable statement balance unavailable instead of substituting a transfer estimate', () => {
  const source = cardStatement({ amountCents: null, issue: 'Statement balance is unavailable.' });
  const row = paymentPresentation(cardWorkspace([cardOccurrence()], [], [source]), '2026-09').rows[0]!;
  expect(row).toMatchObject({ status: 'unknown', amountCents: null, amountKind: 'statement',
    dueDate: '2026-09-20', scheduledDate: '2026-09-18', occurrence: { amount: 200 }, statements: [source] });
});

it('retains schedule estimates while awaiting a card statement and does not select an ambiguous scheduled transfer', () => {
  const withoutStatement = cardWorkspace([cardOccurrence()], [], []);
  expect(paymentPresentation(withoutStatement, '2026-09').rows[0]).toMatchObject({ isCreditCard: true, status: 'scheduled',
    amountCents: 20000, amountKind: 'estimate', dueDate: '2026-09-18', scheduledDate: '2026-09-18', statements: [] });
  const multiple = cardWorkspace([cardOccurrence(), cardOccurrence({ id: 'additional', next_date: '2026-09-19', amount: 50 })]);
  expect(paymentPresentation(multiple, '2026-09').rows[0]).toMatchObject({ status: 'statement', amountCents: 80000, scheduledDate: null });
});

it('does not infer card behavior from a payment name or user-defined display group', () => {
  const data = cardWorkspace([cardOccurrence({ name: 'Credit Card Payment' })], [], []);
  data.paymentItems![0]!.kind = 'recurring';
  data.paymentOrganization = { budgetId: 'budget', revision: 1, groups: [{ id: 'mine', name: 'Credit cards', itemIds: ['schedule:card'] }] };
  const before = paymentPresentation(data, '2026-09').rows;
  expect(before[0]!.isCreditCard).toBe(false);
  data.paymentOrganization.groups[0]!.name = 'Utilities';
  expect(paymentPresentation(data, '2026-09').rows).toEqual(before);
});
