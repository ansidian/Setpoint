// Shared interpretation of an Actual `amount` schedule condition.
//
// An `amount` condition is either a scalar (cents) or, for the `isbetween`
// operator, a `{ num1, num2 }` range. Several layers used to read only `num1`,
// which rendered the *low* end of the range as the bill's dollar figure — wrong
// on every isbetween schedule (P3-76). This module is the single source of truth
// so the four former copy-pasted implementations cannot drift.

// Signed bounds of an amount condition. A fixed amount collapses to lo === hi.
export function amountConditionBounds(condition?: ActualScheduleCondition | null): { lo: number; hi: number; isRange: boolean } {
  const rawAmt = condition?.value;
  if (typeof rawAmt === "object" && rawAmt !== null) {
    const num1 = rawAmt.num1 ?? 0;
    const num2 = rawAmt.num2 ?? num1;
    return { lo: Math.min(num1, num2), hi: Math.max(num1, num2), isRange: true };
  }
  const scalar = typeof rawAmt === "number" ? rawAmt : 0;
  return { lo: scalar, hi: scalar, isRange: false };
}

// Representative signed figure (cents) for display: the midpoint of a range
// schedule, or the fixed amount as-is. Replaces the legacy `num1`-only reads.
export function amountConditionCents(condition?: ActualScheduleCondition | null): number {
  const { lo, hi } = amountConditionBounds(condition);
  return (lo + hi) / 2;
}
import type { ActualScheduleCondition } from "../../shared/types/actual.ts";
