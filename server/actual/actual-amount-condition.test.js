import { describe, it, expect } from "vitest";
import { amountConditionBounds, amountConditionCents } from "./actual-amount-condition.js";

describe("actual amount-condition interpretation (P3-76)", () => {
  it("returns a fixed amount unchanged (lo === hi, not a range)", () => {
    expect(amountConditionBounds({ value: 1234 })).toEqual({ lo: 1234, hi: 1234, isRange: false });
    expect(amountConditionCents({ value: 1234 })).toBe(1234);
  });

  it("represents an isbetween range by its midpoint, not the low end (the P3-76 bug)", () => {
    const between = { value: { num1: 1000, num2: 3000 } };
    // The legacy code returned num1 (1000); the correct display figure is the midpoint.
    expect(amountConditionCents(between)).toBe(2000);
    expect(amountConditionBounds(between)).toEqual({ lo: 1000, hi: 3000, isRange: true });
  });

  it("normalizes an out-of-order range (num1 > num2) and preserves sign", () => {
    expect(amountConditionBounds({ value: { num1: -100, num2: -500 } }))
      .toEqual({ lo: -500, hi: -100, isRange: true });
    expect(amountConditionCents({ value: { num1: -100, num2: -500 } })).toBe(-300);
  });

  it("treats a missing/blank condition as 0", () => {
    expect(amountConditionCents(undefined)).toBe(0);
    expect(amountConditionCents({ value: null })).toBe(0);
    expect(amountConditionBounds({ value: { num2: 500 } })).toEqual({ lo: 0, hi: 500, isRange: true });
  });
});
