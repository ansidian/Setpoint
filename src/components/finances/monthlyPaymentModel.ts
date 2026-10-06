import type { RecordedPayment } from './paymentPresentationModel';

export interface MonthlyPaymentAmount {
  month: string;
  amountCents: number | null;
  paymentCount: number;
  payments: RecordedPayment[];
}

/** Recorded dates own totals; each recorded transaction (or reciprocal pair) counts once. */
export function monthlyPaymentAmounts(payments: RecordedPayment[], endMonth: string): MonthlyPaymentAmount[] {
  const consumed = new Set<string>();
  const unique = payments.filter(payment => {
    if (payment.ids.some(id => consumed.has(id))) return false;
    payment.ids.forEach(id => consumed.add(id));
    return true;
  });
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(`${endMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 11 + index);
    return date.toISOString().slice(0, 7);
  });
  return months.map(month => {
    const records = unique.filter(payment => payment.date.startsWith(month));
    return { month, amountCents: !records.length || records.some(payment => payment.amountCents === null)
      ? null : records.reduce((sum, payment) => sum + payment.amountCents!, 0),
    paymentCount: records.length, payments: records };
  });
}
