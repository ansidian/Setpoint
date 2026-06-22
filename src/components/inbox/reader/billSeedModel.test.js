import { describe, expect, it } from "vitest";
import { formatBillAmount, resolveBillSeed } from "./billSeedModel.js";

describe("resolveBillSeed", () => {
  it("prefers the resolver's resolvedBill (same reference)", () => {
    const resolved = { payee: "PG&E", amount: 88.5, due_date: "2026-05-01", type: "expense" };
    const extracted = { payee: "ignored", amount: 1, due_date: "", type: "expense" };
    expect(resolveBillSeed({ resolvedBill: resolved }, extracted)).toBe(resolved);
  });

  it("falls back to the email's extracted bill when there is no resolved bill", () => {
    const extracted = { payee: "Comcast", amount: 70, due_date: "2026-05-02", type: "expense" };
    expect(resolveBillSeed(null, extracted)).toBe(extracted);
    expect(resolveBillSeed({ resolvedBill: null }, extracted)).toBe(extracted);
  });

  it("falls back to an empty expense seed when neither is present", () => {
    const empty = { payee: "", amount: null, due_date: "", type: "expense" };
    expect(resolveBillSeed(null, null)).toEqual(empty);
    expect(resolveBillSeed(undefined, undefined)).toEqual(empty);
  });
});

describe("formatBillAmount", () => {
  it("formats a number as USD with grouping, two fraction digits, and a $ prefix", () => {
    expect(formatBillAmount(88.5)).toBe("$88.50");
    expect(formatBillAmount(1234.5)).toBe("$1,234.50");
    expect(formatBillAmount(0)).toBe("$0.00");
  });

  it("returns an empty string for null or undefined (but not 0)", () => {
    expect(formatBillAmount(null)).toBe("");
    expect(formatBillAmount(undefined)).toBe("");
  });
});
