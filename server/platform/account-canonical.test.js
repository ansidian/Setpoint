import { describe, expect, it } from "vitest";
import {
  canonicalizeConfiguredAccounts,
  normalizeEmailAddress,
  findCanonicalGmailAccount,
} from "./account-canonical.js";

describe("account canonicalization", () => {
  it("normalizes email casing and whitespace", () => {
    expect(normalizeEmailAddress("  Example@Email.COM ")).toBe("example@email.com");
  });

  it("collapses duplicate Gmail accounts by normalized email", () => {
    const accounts = canonicalizeConfiguredAccounts([
      { id: "gmail-old", type: "gmail", email: "User@example.com", updated_at: "2026-04-19T10:00:00Z", sort_order: 1 },
      { id: "gmail-new", type: "gmail", email: "user@example.com", updated_at: "2026-04-20T10:00:00Z", sort_order: 4 },
      { id: "icloud-main", type: "icloud", email: "me@icloud.com", sort_order: 2 },
    ]);

    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.type === "gmail").id).toBe("gmail-new");
  });

  it("finds the canonical Gmail row for a normalized email", () => {
    const canonical = findCanonicalGmailAccount([
      { id: "gmail-old", type: "gmail", email: "user@example.com", updated_at: "2026-04-18T10:00:00Z" },
      { id: "gmail-fresh", type: "gmail", email: "USER@example.com", updated_at: "2026-04-20T10:00:00Z" },
    ], " user@example.com ");

    expect(canonical.id).toBe("gmail-fresh");
  });
});
