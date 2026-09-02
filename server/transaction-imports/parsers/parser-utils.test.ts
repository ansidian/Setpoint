import { describe, expect, it } from "vitest";
import {
  commonWarnings,
  decimalAmountToCents,
  hasTrustedSender,
  parseIsoDate,
} from "./parser-utils.ts";
import { emailFixture } from "./fixtures.ts";

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

  it("blocks automatic import when provider authentication is absent or failed", () => {
    const unavailable = commonWarnings(
      emailFixture({ senderAuthentication: undefined }),
      ["auto-confirm@amazon.com"],
      "111-2222222-3333333",
      "USD",
      false,
    );
    const failed = commonWarnings(
      emailFixture({
        senderAuthentication: {
          ...emailFixture().senderAuthentication!,
          status: "fail",
        },
      }),
      ["auto-confirm@amazon.com"],
      "111-2222222-3333333",
      "USD",
      false,
    );

    expect(unavailable).toContainEqual(expect.objectContaining({
      code: "sender_authentication_unavailable",
      blocking: true,
    }));
    expect(failed).toContainEqual(expect.objectContaining({
      code: "sender_authentication_failed",
      blocking: true,
    }));
  });
});
