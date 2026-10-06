import { expect, it } from 'vitest';
import type { RecordedPayment } from './paymentPresentationModel';
import { monthlyPaymentAmounts } from './monthlyPaymentModel';
const payment = (id: string, fields: Partial<RecordedPayment> = {}): RecordedPayment => ({ id, ids: [id], date: '2026-09-01', amountCents: 10165, account: 'Checking', notes: '', payee: 'SCE', cleared: true, reconciled: false, target: { view: 'journal', transactionId: id, date: '2026-09-01' }, ...fields });
it('sums multiple Actual payments by recording month and preserves unloaded months as gaps', () => {
  const result = monthlyPaymentAmounts([payment('a', { date: '2026-08-31', amountCents: 5000 }), payment('b'), payment('c', { amountCents: 2000 })], '2026-09');
  expect(result).toHaveLength(12);
  expect(result[0]).toMatchObject({ month: '2025-10', amountCents: null });
  expect(result.slice(-2)).toMatchObject([{ month: '2026-08', amountCents: 5000, paymentCount: 1 }, { month: '2026-09', amountCents: 12165, paymentCount: 2 }]);
});
it('counts a reciprocal transfer pair once', () => {
  const result = monthlyPaymentAmounts([payment('paid', { ids: ['paid', 'pair'] }), payment('pair', { ids: ['pair', 'paid'] })], '2026-09');
  expect(result[11]).toMatchObject({ amountCents: 10165, paymentCount: 1 });
  expect(result[11]?.payments.map(value => value.id)).toEqual(['paid']);
});
it('does not turn partial recorded amounts into a false total', () => {
  expect(monthlyPaymentAmounts([payment('a'), payment('b', { amountCents: null })], '2026-09')[11]).toMatchObject({ amountCents: null, paymentCount: 2 });
});
