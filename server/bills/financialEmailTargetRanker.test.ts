import { describe, expect, it, vi } from "vitest";
import type { BillExtractionProvider } from "../../shared/types/bills.ts";
import { rankFinancialTargetBundles } from "./financialEmailTargetRanker.ts";

function providerWith(fields: Record<string, unknown>): BillExtractionProvider {
  return { extract: vi.fn(async () => ({ fields, usage: {} })) } as BillExtractionProvider;
}

const input = {
  content: "Your Acme purchase was charged to the household card.",
  candidate: { event_kind: "purchase" as const, payee: "Acme" },
  options: [
    { key: "option_1", description: "Household card · Acme · Shopping" },
    { key: "option_2", description: "Travel card · Acme · Travel" },
  ],
  model: "fixture",
};

describe("rankFinancialTargetBundles", () => {
  it("selects only a supplied key with high-confidence verbatim evidence", async () => {
    const result = await rankFinancialTargetBundles({
      ...input,
      provider: providerWith({
        target_policy_key: "option_1",
        target_confidence: 0.91,
        target_evidence: "charged to the household card",
      }),
    });

    expect(result).toEqual({
      status: "selected",
      key: "option_1",
      confidence: 0.91,
      evidence: "charged to the household card",
    });
  });

  it("can validate one corroborated Actual option from semantic email evidence", async () => {
    const result = await rankFinancialTargetBundles({
      ...input,
      content: "Merchant EXAMPLE MARKET #100 TEST CITY charged your card.",
      candidate: { event_kind: "purchase", payee_hint: "EXAMPLE MARKET #100 TEST CITY" },
      options: [{ key: "option_1", description: "Costco Anywhere Card · Costco" }],
      provider: providerWith({
        target_policy_key: "option_1",
        target_confidence: 0.98,
        target_evidence: "EXAMPLE MARKET #100 TEST CITY",
      }),
    });

    expect(result).toEqual({
      status: "selected",
      key: "option_1",
      confidence: 0.98,
      evidence: "EXAMPLE MARKET #100 TEST CITY",
    });
  });

  it.each([
    [{ target_policy_key: "invented", target_confidence: 0.99, target_evidence: "household card" }],
    [{ target_policy_key: "option_1", target_confidence: 0.79, target_evidence: "household card" }],
    [{ target_policy_key: "option_1", target_confidence: 0.99, target_evidence: "not in the email" }],
  ])("fails closed for an invalid ranking result", async (fields) => {
    const result = await rankFinancialTargetBundles({ ...input, provider: providerWith(fields) });
    expect(result.status).toBe("unresolved");
    expect(result.key).toBeNull();
  });

  it("fails closed when the provider is unavailable", async () => {
    const provider = { extract: vi.fn(async () => { throw new Error("offline"); }) } as BillExtractionProvider;
    await expect(rankFinancialTargetBundles({ ...input, provider })).resolves.toMatchObject({ status: "failed" });
  });

  it("sends opaque option keys and descriptions without leaking Actual IDs", async () => {
    let captured: Parameters<BillExtractionProvider["extract"]>[0] | null = null;
    const provider: BillExtractionProvider = {
      extract: async (request) => {
        captured = request;
        return {
          fields: {
            target_policy_key: "option_1",
            target_confidence: 0.9,
            target_evidence: "household card",
          },
          usage: {},
        };
      },
    };
    await rankFinancialTargetBundles({ ...input, provider });

    expect(captured).toBeTruthy();
    expect(captured!.systemPrompt).toContain("option_1");
    expect(captured!.systemPrompt).not.toContain("acct-secret-id");
    expect(captured!.content).toBe(input.content);
  });
});
