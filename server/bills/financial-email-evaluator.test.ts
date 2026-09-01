import { describe, expect, it } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import { evaluateFinancialEmail } from "./financial-email-evaluator.ts";

function candidate(overrides: BillCandidate = {}): BillCandidate {
  return {
    payee: "Example Merchant",
    amount: 42.25,
    amount_kind: "total_due",
    amount_candidates: [{ kind: "total_due", value: 42.25, confidence: 0.99 }],
    event_kind: "purchase",
    event_confidence: 0.99,
    event_evidence: "purchase evidence",
    due_date: "2026-09-10",
    semantic_enrichment: { status: "complete", provider: "openai", model: "fixture" },
    ...overrides,
  };
}

describe("write-disabled financial email evaluator", () => {
  it("returns only redacted operation, target, and reconciliation diagnostics", async () => {
    const result = await evaluateFinancialEmail("u1", {
      email: { body: "private body with $42.25" },
      candidate: candidate({
        account_id: "actual-account-secret",
        category_id: "actual-category-secret",
        target_policy_key: "mapping-policy-secret",
      }),
    }, {
      bill: { type: "expense", amount: 42.25, account_id: "legacy-account-secret" },
      mapping: {
        status: "matched",
        reason: "legacy_match",
        profileId: "profile-secret",
        behaviorId: "behavior-secret",
      },
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      writesEnabled: false,
      legacy: { mappingStatus: "matched", billType: "expense" },
      plan: {
        documentKind: "one_time_transaction",
        intendedOperation: "create_transaction",
        operation: "review",
        automationEligible: false,
      },
      comparison: {
        operationAgreement: true,
        targetAgreement: {
          account: "unresolved",
          payee: "unresolved",
          category: "unresolved",
          fromAccount: "not_applicable",
          toAccount: "not_applicable",
          schedule: "not_applicable",
        },
      },
    });
    for (const secret of [
      "private body", "42.25", "actual-account-secret", "actual-category-secret",
      "mapping-policy-secret", "profile-secret", "behavior-secret",
    ]) expect(serialized).not.toContain(secret);
  });
});
