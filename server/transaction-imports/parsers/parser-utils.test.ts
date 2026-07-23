import { describe, expect, it } from "vitest";
import { decimalAmountToCents, hasTrustedSender, parseIsoDate } from "./parser-utils.ts";

describe("transaction parser normalization", () => {
  it.each([
    ["1", 100],
    ["1.2", 120],
    ["1.23", 123],
    ["1,234.56", 123456],
    ["0.00", null],
    ["12.345", null],
    ["not-money", null],
  ])("normalizes amount %s", (input, expected) => {
    expect(decimalAmountToCents(input)).toBe(expected);
  });

  it("rejects invalid dates instead of defaulting to today", () => {
    expect(parseIsoDate("not-a-date")).toBeNull();
    expect(parseIsoDate("2026-07-22T10:00:00Z")).toBe("2026-07-22");
  });

  it.each([
    ["Amazon <auto-confirm@amazon.com>", true],
    ["AUTO-CONFIRM@AMAZON.COM", true],
    ["Spoof <auto-confirm@amazon.com.attacker.test>", false],
    ["forwarded by owner@example.com", false],
  ])("compares the exact normalized sender mailbox", (from, expected) => {
    expect(hasTrustedSender(from, ["auto-confirm@amazon.com"])).toBe(expected);
  });
});
