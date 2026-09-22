import { describe, expect, it } from "vitest";
import { createFinancialEmailPlanner } from "./financial-email-planner.ts";
import { verifyBillEvent } from "./billEventVerifier.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";

const fixedNow = () => new Date("2026-09-01T12:00:00.000Z");

function candidate(event_kind: BillCandidate["event_kind"], overrides: BillCandidate = {}): BillCandidate {
  return {
    payee: "Example Merchant",
    amount: 42.25,
    amount_kind: event_kind === "refund" ? "refund_amount" : "total_due",
    amount_candidates: [{ kind: event_kind === "refund" ? "refund_amount" : "total_due", value: 42.25, confidence: 0.99 }],
    event_kind,
    event_confidence: 0.99,
    event_evidence: `${event_kind} evidence`,
    event_verification: { status: "kept_initial", provider: "openai", model: "fixture" },
    due_date: "2026-09-10",
    semantic_enrichment: { status: "complete", provider: "openai", model: "fixture" },
    ...overrides,
  };
}

function planner() {
  return createFinancialEmailPlanner({
    profileReader: async () => ({ budgetId: null, revision: 0, profiles: [] }),
    metadataReader: async () => ({
      accounts: [],
      payees: [],
      payeeMap: {},
      categories: [],
      schedules: [],
      recentTransactions: [],
      syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
    }),
    occurrenceReader: async () => ({
      schedules: [],
      syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
    }),
    transactionReader: async () => ({ transactions: [] }),
    now: fixedNow,
  });
}

describe("financial event admission planning", () => {
  it.each(["nonfinancial", "uncertain"] as const)("keeps an explicit %s audit from authorizing a financial write", async (outcome) => {
    const result=await planner()("u1",{candidate:candidate("purchase",{type:"expense",type_confidence:0.99,
      type_evidence:"Your order",event_verification:{status:"kept_initial",assessment:{outcome,evidence:"Your order"}}})});
    expect(result).toMatchObject({operation:{intended:outcome === "nonfinancial" ? "no_write" : null,
      kind:outcome === "nonfinancial" ? "no_write" : "review"},automation:{eligible:false}});
  });
  it.each(["accepted", "failed", "legacy_failed"])("plans a mapped payment with a %s event audit safely", async (audit) => {
    const plan = createFinancialEmailPlanner({
      profileReader: async () => ({ budgetId: "budget-1", revision: 1, profiles: [{
        id: "card-payment", name: "Everyday Card", enabled: true, budgetId: "budget-1", senderAddresses: ["payments@card.example"],
        target: { kind: "card_payment", fromAccountId: "checking", toAccountId: "card" },
      }] }),
      metadataReader: async () => ({
        accounts: [
          { id: "checking", name: "Household Checking 1111", type: "checking" },
          { id: "card", name: "Everyday Card 4242", type: "credit" },
        ],
        payees: [],
        payeeMap: {},
        categories: [],
        schedules: [],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({
        transactions: [
          { id: "t1", date: "2026-08-01", amount: 42.25, direction: "expense", payee: "Transfer", category: "", account: "Household Checking 1111", accountId: "checking", transferAccountId: "card", notes: "" },
          { id: "t2", date: "2026-07-01", amount: 42.25, direction: "expense", payee: "Transfer", category: "", account: "Household Checking 1111", accountId: "checking", transferAccountId: "card", notes: "" },
        ],
      }),
      now: fixedNow,
    });
    const payment = candidate("payment_scheduled", {
        type: "transfer",
        payee: "Everyday Card",
        event_evidence: "Your payment of $42.25 is scheduled for September 10, 2026",
        amount_kind: "payment_amount",
        amount_candidates: [{ kind: "payment_amount", value: 42.25, confidence: 0.99,
          evidence: "Your payment of $42.25 is scheduled for September 10, 2026" }],
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Card ending in 4242",
      });
    const body = "Your payment of $42.25 is scheduled for September 10, 2026. Card ending in 4242.";
    const audited = audit === "accepted" ? payment : (await verifyBillEvent({
      content: body, candidate: payment, requireAdmission: true,
      provider: { extract: async () => { throw new Error("Provider unavailable"); } },
      providerId: "openai", model: "fixture",
    })).candidate;
    // Saved failures from before admission outcomes existed must also block writes.
    if (audit === "legacy_failed") delete audited.event_verification?.assessment;
    const result = await plan("u1", {
      candidate: audited,
      sourceIdentity: { senderAddress: "payments@card.example", senderAuthentication: "pass" },
      email: { subject: "Your card payment is scheduled",
        body: "Your payment of $42.25 is scheduled for September 10, 2026. Card ending in 4242." },
    });

    if (audit !== "accepted") {
      expect(result.operation.kind).toBe("review");
      expect(result.automation.eligible).toBe(false);
      expect(result.reviewReasons).toContainEqual(expect.objectContaining({ code: "provider_unavailable", blocking: true }));
      expect(result.candidate.event_verification?.status).toBe("failed");
      return;
    }

    expect(result.operation).toEqual({ intended: "create_transfer_schedule", kind: "create_transfer_schedule", reasons: [] });
    expect(result.targets).toMatchObject({
      fromAccount: { status: "resolved", id: "checking" },
      toAccount: { status: "resolved", id: "card" },
      schedule: { status: "not_applicable" },
      category: { status: "not_applicable" },
    });
  });

});
