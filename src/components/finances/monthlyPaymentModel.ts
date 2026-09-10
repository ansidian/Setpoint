import type { UtilityStatement } from '../../../shared/types/finances';
import type { RecordedPayment } from './paymentPresentationModel';

export interface MonthlyPaymentAmount {
  month: string;
  amountCents: number | null;
  excludedFeeCents: number;
  paymentCount: number;
  payments: Array<RecordedPayment & { statements: UtilityStatement[] }>;
  statements: UtilityStatement[];
}

/** Recorded dates own totals; only exact recorded fee breakdowns reduce them. */
export function monthlyPaymentAmounts(payments: RecordedPayment[], statements: UtilityStatement[], endMonth: string): MonthlyPaymentAmount[] {
  const consumed = new Set<string>();
  const unique = payments.filter(payment => {
    if (payment.ids.some(id => consumed.has(id))) return false;
    payment.ids.forEach(id => consumed.add(id));
    return true;
  });
  const sources = [...new Map(statements.map(statement => [statement.id, statement])).values()];
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(`${endMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 11 + index);
    return date.toISOString().slice(0, 7);
  });
  return months.map(month => {
    const records = unique.filter(payment => payment.date.startsWith(month));
    const monthSources = sources.filter(statement => {
      const linked = unique.filter(payment => statement.paymentTransactionIds.some(id => payment.ids.includes(id)));
      if (linked.length) return linked.some(payment => payment.date.startsWith(month));
      const date = statement.paymentDate || statement.dueDate || statement.statementDate || statement.receivedAt;
      return date.startsWith(month);
    });
    const sourceOwner = (statement: UtilityStatement) => records.find(payment => statement.paymentTransactionIds.some(id => payment.ids.includes(id)));
    let excludedFeeCents = 0;
    for (const payment of records) {
      if (payment.amountCents === null) continue;
      const breakdowns = statements.filter(statement => statement.feeCents != null
        && statement.paymentTransactionIds.some(id => payment.ids.includes(id)));
      if (breakdowns.length) {
        const valid = breakdowns.every(statement => statement.paymentTransactionIds.length === 1
          && statement.recordedTotalCents === payment.amountCents && statement.feeCents! >= 0
          && statement.feeCents! <= payment.amountCents!);
        const fees = new Set(breakdowns.map(statement => statement.feeCents!));
        if (valid && fees.size === 1) excludedFeeCents += [...fees][0]!;
      }
    }
    return { month, amountCents: !records.length || records.some(payment => payment.amountCents === null)
      ? null : records.reduce((sum, payment) => sum + payment.amountCents!, 0) - excludedFeeCents,
    excludedFeeCents, paymentCount: records.length,
    payments: records.map(payment => ({ ...payment, statements: monthSources.filter(statement => sourceOwner(statement)?.id === payment.id) })),
    statements: monthSources.filter(statement => !sourceOwner(statement)) };
  });
}
