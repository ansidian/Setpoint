import type { ActualBillOccurrence } from '../../shared/types/actual.ts';
import type { JournalTransaction } from '../../shared/types/finances.ts';

/** Older retained paid mirrors lack IDs. Recover only an unambiguous exact schedule posting on that occurrence date. */
export function hydrateLegacyOccurrencePayments(occurrences: ActualBillOccurrence[], transactions: JournalTransaction[]): ActualBillOccurrence[] {
  return occurrences.map(occurrence => {
    if (!occurrence.paid || occurrence.paymentTransactionIds !== undefined || !occurrence.scheduleId
      || occurrences.filter(row => row.scheduleId === occurrence.scheduleId && row.next_date === occurrence.next_date).length !== 1) return occurrence;
    const matches = transactions.filter(row => row.scheduleId === occurrence.scheduleId && row.date === occurrence.next_date
      && !row.isChild && (occurrence.type === 'transfer' ? row.amountCents !== 0 : occurrence.type === 'income' ? row.amountCents > 0 : row.amountCents < 0));
    if (matches.length === 1) return { ...occurrence, paymentTransactionIds: [matches[0]!.id] };
    const [first, second] = matches;
    const reciprocalPair = occurrence.type === 'transfer' && matches.length === 2 && first && second
      && !first.isParent && !second.isParent && first.id !== second.id
      && first.transferId === second.id && second.transferId === first.id
      && first.amountCents === -second.amountCents && first.accountId && second.accountId && first.accountId !== second.accountId;
    return reciprocalPair ? { ...occurrence, paymentTransactionIds: [first.id, second.id] } : occurrence;
  });
}
