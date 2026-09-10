import { describe, expect, it } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import { applyOwnerFinancialEmailPolicy } from "./financialEmailRewardEvidence.ts";

describe("owner financial email policy", () => {
  it.each(["SC123456", "CB123456"])("preserves source settlement evidence instead of inferring a destination from reference %s", (reference) => {
    const candidate: BillCandidate = {
      event_kind: "reward", payee: "Chase Ultimate Rewards",
      provider_reference: reference, provider_reference_confidence: 0.99,
      provider_reference_evidence: `Order number ${reference}`,
    };
    expect(applyOwnerFinancialEmailPolicy(candidate)).toEqual(candidate);
    for (const settlement_kind of ["statement_credit", "bank_deposit"] as const) {
      const evidenced: BillCandidate = { ...candidate, settlement_kind, settlement_confidence: 0.9,
        settlement_evidence: "Cash back was applied to your selected account" };
      expect(applyOwnerFinancialEmailPolicy(evidenced)).toEqual(evidenced);
    }
  });
});
