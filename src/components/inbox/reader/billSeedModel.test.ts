import { describe, expect, it } from "vitest";
import { resolveBillSeed } from "./billSeedModel";

describe("resolveBillSeed", () => {
  it("prefers the resolver's bill over the email extraction", () => {
    const resolved = { payee: "PG&E", amount: 88.5, due_date: "2026-05-01", type: "expense" };
    const extracted = { payee: "ignored", amount: 1, due_date: "", type: "expense" };
    expect(resolveBillSeed({ resolvedBill: resolved }, extracted)).toEqual(resolved);
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
