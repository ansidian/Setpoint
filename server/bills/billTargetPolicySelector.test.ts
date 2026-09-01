import { describe, expect, it } from "vitest";
import type { BillExtractionProvider, BillPayBehavior } from "../../shared/types/bills.ts";
import { semanticTargetPolicies } from "./billSemanticEventPolicy.ts";
import { selectBillTargetPolicy } from "./billTargetPolicySelector.ts";

const behaviors: BillPayBehavior[] = [
  { id: "fuel", name: "Transaction Gas", type: "expense", targets: { category_id: "gas", category_label: "Gas" } },
  { id: "store", name: "Transaction", type: "expense", targets: { category_id: "store", category_label: "Costco" } },
];

function providerWith(fields: Record<string, unknown>): BillExtractionProvider {
  return { extract: async () => ({ fields, usage: { input_tokens: 10 } }) } as BillExtractionProvider;
}

describe("bill target policy selector", () => {
  it("accepts a confident choice from the supplied policy set", async () => {
    const fuelKey = semanticTargetPolicies(behaviors, { event_kind: "purchase", type: "expense" })
      .policies.find((policy) => policy.behavior.id === "fuel")!.key;
    const result = await selectBillTargetPolicy({
      content: "Transaction at Costco Gas",
      candidate: { event_kind: "purchase", type: "expense", amount: 42 },
      behaviors,
      provider: providerWith({
        target_policy_key: fuelKey,
        target_confidence: 0.99,
        target_evidence: "Costco Gas",
      }),
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate).toMatchObject({
      target_policy_key: fuelKey,
      target_verification: { status: "selected", option_count: 2 },
    });
  });

  it("rejects fabricated and low-confidence policy choices", async () => {
    const result = await selectBillTargetPolicy({
      content: "Transaction",
      candidate: { event_kind: "purchase", type: "expense" },
      behaviors,
      provider: providerWith({
        target_policy_key: "policy-invented",
        target_confidence: 0.99,
        target_evidence: "Transaction",
      }),
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate).toMatchObject({
      target_policy_key: null,
      target_verification: { status: "kept_ambiguous" },
    });
  });

  it("fails closed when the selector is unavailable", async () => {
    const provider = { extract: async () => { throw new Error("offline"); } } as BillExtractionProvider;
    const result = await selectBillTargetPolicy({
      content: "Transaction",
      candidate: { event_kind: "purchase", type: "expense" },
      behaviors,
      provider,
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate.target_policy_key).toBeNull();
    expect(result.candidate.target_verification?.status).toBe("failed");
  });
});
