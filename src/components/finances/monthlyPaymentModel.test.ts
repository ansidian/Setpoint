import { expect, it } from 'vitest';
import type { UtilityStatement } from '../../../shared/types/finances';
import type { RecordedPayment } from './paymentPresentationModel';
import { monthlyPaymentAmounts } from './monthlyPaymentModel';
const payment = (id: string, fields: Partial<RecordedPayment> = {}): RecordedPayment => ({ id, ids: [id], date: '2026-09-01', amountCents: 10165, account: 'Checking', notes: '', payee: 'SCE', cleared: true, reconciled: false, target: { view: 'journal', transactionId: id, date: '2026-09-01' }, ...fields });
const statement = (fields: Partial<UtilityStatement> = {}): UtilityStatement => ({ id: 'statement', utilityId: 'electricity', emailUid: 'email', subject: 'Electricity bill', receivedAt: '2026-08-20', statementDate: null, dueDate: '2026-09-01', amountCents: 10000, amountKind: 'total_due', nothingDue: false, creditCents: null, newChargesCents: null, carriedBalanceCents: null, providerReference: null, activity: null, paymentTransactionIds: ['paid'], paymentDate: '2026-09-01', recordedTotalCents: 10165, feeCents: 165, issue: null, ...fields });
it('sums multiple Actual payments by recording month and preserves unloaded months as gaps', () => {
  const result = monthlyPaymentAmounts([payment('a', { date: '2026-08-31', amountCents: 5000 }), payment('b'), payment('c', { amountCents: 2000 })], [], '2026-09');
  expect(result).toHaveLength(12);
  expect(result[0]).toMatchObject({ month: '2025-10', amountCents: null });
  expect(result.slice(-2)).toMatchObject([{ month: '2026-08', amountCents: 5000, excludedFeeCents: 0, paymentCount: 1 }, { month: '2026-09', amountCents: 12165, excludedFeeCents: 0, paymentCount: 2 }]);
});
it('deducts a hydrated exact fee once despite duplicate source statements or transfer IDs', () => {
  const result = monthlyPaymentAmounts([payment('paid', { ids: ['paid', 'pair'] }), payment('pair', { ids: ['pair', 'paid'] })], [statement(), statement({ id: 'second-source' })], '2026-09');
  expect(result[11]).toMatchObject({ amountCents: 10000, excludedFeeCents: 165, paymentCount: 1 });
  expect(result[11]?.payments.map(value => value.id)).toEqual(['paid']);
  expect(result[11]?.payments[0]?.target).toEqual({ view: 'journal', transactionId: 'paid', date: '2026-09-01' });
});
it('never guesses fees from provider policy, notes, ambiguous links, or conflicting amounts', () => {
  for (const statements of [[], [statement({ paymentTransactionIds: ['other'] })], [statement({ paymentTransactionIds: ['paid', 'other'] })], [statement({ recordedTotalCents: 10500 })], [statement(), statement({ feeCents: 150 })]]) {
    expect(monthlyPaymentAmounts([payment('paid', { notes: 'SCE card fee' })], statements, '2026-09')[11]).toMatchObject({ amountCents: 10165, excludedFeeCents: 0 });
  }
});
it('does not turn partial recorded amounts into a false total', () => {
  expect(monthlyPaymentAmounts([payment('a'), payment('b', { amountCents: null })], [], '2026-09')[11]).toMatchObject({ amountCents: null, paymentCount: 2 });
});
it('uses exact fee breakdowns including zero and rejects conflicts', () => {
  expect(monthlyPaymentAmounts([payment('paid')], [statement({ feeCents: 200 })], '2026-09')[11]).toMatchObject({ amountCents: 9965, excludedFeeCents: 200 });
  expect(monthlyPaymentAmounts([payment('paid')], [statement({ feeCents: 0 })], '2026-09')[11]).toMatchObject({ amountCents: 10165, excludedFeeCents: 0 });
  expect(monthlyPaymentAmounts([payment('paid')], [statement(), statement({ feeCents: 150 })], '2026-09')[11]).toMatchObject({ amountCents: 10165, excludedFeeCents: 0 });
});
