import { describe, expect, it } from "vitest";
import { financialEmailIdentity } from "./financialEmailIdentity.ts";

describe("financial email identity", () => {
  it("is stable across retries and does not expose provider identity material", () => {
    const input = {
      source: "triage",
      providerMessageId: "GMAIL-MESSAGE-123",
      candidateIdentityHint: 0,
      sourceIdentity: { provider: "gmail", accountId: "Owner@Example.com" },
    };
    const first = financialEmailIdentity("owner-1", input);
    const retried = financialEmailIdentity(" OWNER-1 ", {
      ...input,
      providerMessageId: "gmail-message-123",
      sourceIdentity: { provider: "GMAIL", accountId: "owner@example.com" },
    });

    expect(retried).toEqual(first);
    expect(first).toMatchObject({ version: 1, status: "resolved" });
    expect(first.key).toMatch(/^financial-email:v1:[a-f0-9]{64}$/);
    expect(first.key).not.toContain("gmail-message-123");
    expect(first.key).not.toContain("owner@example.com");
  });

  it("separates multiple candidates from one provider message", () => {
    const base = {
      providerMessageId: "message-1",
      sourceIdentity: { provider: "gmail", accountId: "account-1" },
    };
    expect(financialEmailIdentity("owner-1", { ...base, candidateIdentityHint: 0 }).key)
      .not.toBe(financialEmailIdentity("owner-1", { ...base, candidateIdentityHint: 1 }).key);
  });

  it("fails closed when the provider message identity is absent", () => {
    expect(financialEmailIdentity("owner-1", { providerMessageId: null })).toEqual({
      version: 1,
      status: "missing",
      key: null,
    });
  });
});
