import { describe, expect, it } from "vitest";
import { createFinancialEmailPlanner } from "./financial-email-planner.ts";

const fixedNow = () => new Date("2026-09-01T12:00:00.000Z");

describe("financial transaction category policy", () => {
  it.each([
    { label: "missing categories", mixedCategories: false, mixedAccounts: false, profileEnabled: false },
    { label: "mixed categories", mixedCategories: true, mixedAccounts: false, profileEnabled: false },
    { label: "mixed categories and accounts", mixedCategories: true, mixedAccounts: true, profileEnabled: false },
    { label: "confirmed account without a category", mixedCategories: true, mixedAccounts: true, profileEnabled: true },
  ])("makes categories optional while preserving unconfigured account ambiguity: $label", async ({ mixedCategories, mixedAccounts, profileEnabled }) => {
    const categories = Array.from({ length: 12 }, (_, index) => ({ id: `c${index}`, name: `Category ${index}` }));
    const plan = createFinancialEmailPlanner({
      profileReader: async () => ({ budgetId: "budget-1", revision: 1, profiles: profileEnabled ? [{
        id: "amazon-purchases", name: "Amazon purchases", enabled: true, budgetId: "budget-1", senderAddresses: ["orders@amazon.example"],
        target: { kind: "expense", accountId: "card", payeeId: "amazon" },
      }] : [] }),
      metadataReader: async () => ({
        accounts: [{ id: "card", name: "Card" }, { id: "checking", name: "Checking" }],
        payees: [{ id: "amazon", name: "Amazon" }],
        payeeMap: { amazon: "Amazon" },
        categories: [{ group_name: "Spending", categories }],
        schedules: [], recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: null },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({
        transactions: categories.map((category, index) => ({
          id: `t${index}`, date: "2026-08-01", amount: 10, direction: "expense" as const,
          payee: "Amazon", payeeId: "amazon", category: mixedCategories ? category.name : "",
          account: mixedAccounts && index % 2 ? "Checking" : "Card",
          accountId: mixedAccounts && index % 2 ? "checking" : "card", notes: "",
        })),
      }),
      now: fixedNow,
    });
    const result = await plan("u1", {
      candidate: {
        payee: "Amazon", type: "expense", currency: "USD",
        amount: 42.25, amount_kind: "transaction_amount",
        event_kind: "purchase", event_confidence: 0.99, event_evidence: "Purchase confirmed",
        due_date: "2026-09-10",
        semantic_enrichment: { status: "complete", provider: "source_adapter", model: "fixture" },
      },
      providerMessageId: "receipt-1",
      sourceIdentity: { senderAddress: "orders@amazon.example", senderAuthentication: "pass" },
      actualPreflight: { status: "passed" },
    });

    expect(result.candidate.category_id).toBeNull();
    expect(result.automation.eligible).toBe(profileEnabled);
    expect(result.operation.kind).toBe(profileEnabled ? "create_transaction" : "review");
    expect(result.reviewReasons.map((reason) => reason.code)).not.toContain("category_target_unresolved");
    if (mixedAccounts && !profileEnabled) {
      expect(result.automation.reasons).toContain("account_target_unresolved");
    } else {
      expect(result.reviewReasons.map((reason) => reason.code)).toEqual(profileEnabled ? [] : ["profile_required"]);
      expect(result.targets.account).toMatchObject({ status: "resolved", id: "card" });
      expect(result.targets.payee).toMatchObject({ status: "resolved", id: "amazon" });
    }
  });
});
