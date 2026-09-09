import { describe, expect, it } from "vitest";
import { createFinancialEmailPlanner } from "./financial-email-planner.ts";
import { rankFinancialTargetBundles } from "./financialEmailTargetRanker.ts";
import type { ActualPayee } from "../../shared/types/actual.ts";
import type { BillCandidate, BillExtractionProvider } from "../../shared/types/bills.ts";

async function planMerchant({
  merchant = "Amazon.com", payees = [{ id: "amazon", name: "Amazon" }],
  fields = { target_policy_key: "payee_1", target_confidence: 0.95, target_evidence: "Amazon.com" },
  offline = false, accountEvidence = true,
}: {
  merchant?: string; payees?: ActualPayee[]; fields?: Record<string, unknown>; offline?: boolean; accountEvidence?: boolean;
} = {}) {
  const body = `Your purchase from ${merchant} was $42.25.${accountEvidence ? " Paid with Card ending in 1234." : ""}`;
  const candidate: BillCandidate = {
    payee: merchant, type: "expense", currency: "USD", amount: 42.25, amount_kind: "transaction_amount",
    event_kind: "purchase", event_confidence: 0.99, event_evidence: "Your purchase", due_date: "2026-09-01",
    semantic_enrichment: { status: "complete", provider: "source_adapter", model: "fixture" },
    ...(accountEvidence ? { account_last4: "1234", account_last4_confidence: 0.99, account_last4_evidence: "Card ending in 1234" } : {}),
  };
  const provider = { extract: async () => {
    if (offline) throw new Error("Provider unavailable");
    return { fields, usage: {} };
  } } as BillExtractionProvider;
  return createFinancialEmailPlanner({
    metadataReader: async () => ({ accounts: [{ id: "card", name: "Card (1234)" }], payees,
      payeeMap: Object.fromEntries(payees.map(payee => [payee.id, payee.name])),
      categories: [], schedules: [], recentTransactions: [], syncHealth: { state: "current", lastSuccessAt: null } }),
    occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
    transactionReader: async () => ({ transactions: [] }),
    targetRanker: ({ candidate: extracted, options }) => rankFinancialTargetBundles({ content: body, candidate: extracted, options, provider, model: "fixture" }),
    now: () => new Date("2026-09-02T12:00:00Z"),
  })("owner", { source: "financial_event", candidate, email: { body }, providerMessageId: "purchase-1",
    sourceIdentity: { senderAuthentication: "pass" }, actualPreflight: { status: "passed" } });
}

describe("existing payee matching before new merchant creation", () => {
  it("resolves Amazon.com to existing Amazon without transaction history", async () => {
    const plan = await planMerchant();
    expect(plan.targets.payee).toMatchObject({ status: "resolved", id: "amazon", label: "Amazon" });
    expect(plan.candidate).toMatchObject({ payee: "Amazon", payee_id: "amazon" });
    expect(plan.targets.account).toMatchObject({ status: "resolved", id: "card" });
    expect(plan.targets.category.status).toBe("unresolved");
  });

  it.each([
    { label: "ambiguous", fields: { target_policy_key: null } },
    { label: "unknown choice", fields: { target_policy_key: "invented", target_confidence: 0.99, target_evidence: "Amazon.com" } },
    { label: "low confidence", fields: { target_policy_key: "payee_1", target_confidence: 0.79, target_evidence: "Amazon.com" } },
    { label: "ungrounded evidence", fields: { target_policy_key: "payee_1", target_confidence: 0.99, target_evidence: "a different merchant" } },
    { label: "provider failure", offline: true },
  ])("keeps likely existing matches in review on $label", async ({ fields, offline }) => {
    const plan = await planMerchant({ fields, offline, payees: [{ id: "amazon", name: "Amazon" }, { id: "amazon-co", name: "Amazon Co" }] });
    expect(plan.targets.payee.status).toBe("unresolved");
    expect(plan.targets.payee.competingCandidates?.map(candidate => candidate.label)).toEqual(["Amazon", "Amazon Co"]);
    expect(plan.operation.kind).toBe("review");
    expect(plan.candidate.payee_id).toBeNull();
  });

  it("does not infer an account or category from a payee-only match", async () => {
    const plan = await planMerchant({ accountEvidence: false });
    expect(plan.targets.payee).toMatchObject({ status: "resolved", id: "amazon" });
    expect(plan.targets.account.status).toBe("unresolved");
    expect(plan.targets.category.status).toBe("unresolved");
  });

  it("keeps an exact existing payee even without the matching provider", async () => {
    expect((await planMerchant({ merchant: "Amazon", offline: true })).targets.payee)
      .toMatchObject({ status: "resolved", id: "amazon", label: "Amazon" });
  });

  it("never selects between indistinguishable duplicate payees", async () => {
    const plan = await planMerchant({ payees: [{ id: "one", name: "Amazon" }, { id: "two", name: "AMAZON" }] });
    expect(plan.targets.payee.status).toBe("unresolved");
    expect(plan.targets.payee.competingCandidates).toHaveLength(2);
  });

  it("excludes transfer payees from merchant choices", async () => {
    const plan = await planMerchant({ payees: [{ id: "transfer", name: "Amazon", transfer_acct: "card" }, { id: "merchant", name: "Amazon" }] });
    expect(plan.targets.payee).toMatchObject({ status: "resolved", id: "merchant", label: "Amazon" });
  });

  it("keeps oversized candidate sets in review instead of silently omitting alternatives", async () => {
    const plan = await planMerchant({ payees: Array.from({ length: 9 }, (_, index) => ({ id: `merchant-${index}`, name: `Amazon${index}` })) });
    expect(plan.targets.payee.status).toBe("unresolved");
    expect(plan.targets.payee.competingCandidates).toHaveLength(9);
  });

  it("still permits a grounded new merchant when there are no plausible existing payees", async () => {
    expect((await planMerchant({ merchant: "Independent Flowers" })).targets.payee)
      .toMatchObject({ status: "resolved", id: null, label: "Independent Flowers" });
  });
});
