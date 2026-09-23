import { expect, it } from 'vitest';
import { parseFinancialEventCompletion } from './financial-event-completion-model.ts';

// Input validation is a pure public boundary; the completion facade separately
// proves that accepted allocations persist in exactly one immutable operation.
const request = { emailUid: 'receipt', documentRevision: 1, eventRevision: null,
  entry: { kind: 'expense', amount: 100, date: '2026-09-20', accountId: 'card', payee: 'Example shop', categoryId: null } };

it.each([
  { splits: [{ amount: 100 }] },
  { splits: [{ amount: 25 }, { amount: 50 }] },
  { splits: [{ amount: 25 }, { amount: 100 }] },
  { splits: [{ amount: -4 }, { amount: 104 }] },
  { splits: [{ amount: 4.001 }, { amount: 95.999 }] },
  { splits: [{ amount: 0 }, { amount: 100 }] },
  { splits: null },
  { splits: [] },
  { kind: 'income', splits: [{ amount: 25 }, { amount: 75 }] },
  { kind: 'bill', splits: [{ amount: 25 }, { amount: 75 }] },
  { categoryId: 'parent', splits: [{ amount: 25 }, { amount: 75 }] },
])('rejects incomplete, imbalanced or unsupported split entries: %j', changes => {
  expect(() => parseFinancialEventCompletion({ ...request, entry: { ...request.entry, ...changes } })).toThrow();
});

it('accepts exact cent allocations with categories and order notes on the children', () => {
  const entry = { ...request.entry, splits: [{ amount: 37.51, categoryId: 'food', notes: 'Order one' }, { amount: 62.49 }] };
  expect(parseFinancialEventCompletion({ ...request, entry }).entry).toMatchObject({ amount: 100, categoryId: null,
    splits: [{ amount: 37.51, categoryId: 'food', notes: 'Order one' }, { amount: 62.49, categoryId: null, notes: '' }] });
});
