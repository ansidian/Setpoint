import type { ActualFinancialSplit } from './types/financial-operations.ts';

export function positiveUsdCents(amount: unknown): number | null {
  if (typeof amount !== 'number') return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents > 0 && Math.abs(amount * 100 - cents) < 0.000001 ? cents : null;
}

/** Expense allocations must exhaust the parent; categories belong to children. */
export function validExpenseSplits(splits: ActualFinancialSplit[], amountCents: number): boolean {
  return Array.isArray(splits) && splits.length >= 2 && splits.length <= 30
    && Number.isSafeInteger(amountCents) && amountCents < 0
    && splits.every(split => split && Number.isSafeInteger(split.amountCents) && split.amountCents < 0
      && (split.categoryId == null || typeof split.categoryId === 'string' && !!split.categoryId.trim())
      && (split.notes == null || typeof split.notes === 'string' && split.notes.length <= 2000))
    && splits.reduce((sum, split) => sum + split.amountCents, 0) === amountCents;
}
