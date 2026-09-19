import { amountConditionBounds, amountConditionCents } from "./actual-amount-condition.ts";
import type { ActualScheduleCondition } from "../../shared/types/actual.ts";

export function conditionForFields(conditions: ActualScheduleCondition[], fields: string[], ops: string[] | null = null): ActualScheduleCondition | null {
  return conditions.find((condition) =>
    typeof condition.field === "string" && fields.includes(condition.field)
      && (!ops || (typeof condition.op === "string" && ops.includes(condition.op)))
  ) || null;
}

export function scheduleAmountMatches(condition: ActualScheduleCondition | null, amountCents: number): boolean {
  if (!condition || !amountCents) return false;
  const amount = Math.abs(amountCents);
  if (condition.op === "is") return Math.abs(amountConditionCents(condition)) === amount;
  if (condition.op === "isapprox") return Math.abs(Math.abs(amountConditionCents(condition)) - amount) / amount < 0.3;
  if (condition.op === "isbetween" && typeof condition.value === "object" && condition.value !== null) {
    const { lo, hi } = amountConditionBounds(condition);
    const loA = Math.abs(lo), hiA = Math.abs(hi);
    return amount >= Math.min(loA, hiA) * 0.7 && amount <= Math.max(loA, hiA) * 1.3;
  }
  return false;
}
