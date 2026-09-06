import { describe, expect, it } from "vitest";
import { createFinancialEmailPlanner } from "./financial-email-planner.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";

function paypalCandidate(overrides: BillCandidate = {}): BillCandidate {
  return {
    payee: "PayPal",
    amount: 22.25,
    amount_kind: "transaction_amount",
    amount_candidates: [{ kind: "transaction_amount", value: 22.25, confidence: 0.99 }],
    due_date: "2026-09-03",
    currency: "USD",
    type: "transfer",
    type_confidence: 0.99,
    type_evidence: "transfer request is processing",
    event_kind: "account_transfer_pending",
    event_confidence: 0.99,
    event_evidence: "Sep 3, 2026 transfer request is processing",
    event_verification: { status: "kept_initial", provider: "openai", model: "fixture" },
    from_account_hint: "PayPal balance",
    from_account_hint_confidence: 0.99,
    to_account_hint: "EXAMPLE BANK x-0001",
    to_account_hint_confidence: 0.99,
    provider_reference: "TEST-TRANSFER-REF-0001",
    provider_reference_confidence: 0.99,
    provider_reference_evidence: "Transaction ID: TEST-TRANSFER-REF-0001",
    semantic_enrichment: { status: "complete", provider: "openai", model: "fixture" },
    ...overrides,
  };
}

const metadata = {
  accounts: [{ id: "savings", name: "Example Savings (0001)", type: "savings" }],
  payees: [{ id: "cashback", name: "Cashback" }, { id: "hardware", name: "/r/hardwareswap" }],
  payeeMap: { cashback: "Cashback", hardware: "/r/hardwareswap" },
  categories: [{ group_name: "Income", categories: [{ id: "cashback-category", name: "Cashback" }] }],
  schedules: [],
  recentTransactions: [],
  syncHealth: { state: "current" as const, lastSuccessAt: "2026-09-04T11:00:00.000Z" },
};

const manualCashback: TransactionRecord = {
  id: "manual-cashback",
  date: "2026-09-03",
  amount: 22.25,
  direction: "income",
  payee: "Cashback",
  payeeId: "cashback",
  category: "Cashback",
  categoryId: "cashback-category",
  account: "Example Savings (0001)",
  accountId: "savings",
  notes: "paypal cashback",
};

function planner(history: TransactionRecord[] = []) {
  return createFinancialEmailPlanner({
    metadataReader: async () => metadata,
    occurrenceReader: async () => ({ schedules: [], syncHealth: metadata.syncHealth }),
    transactionReader: async () => ({ transactions: history }),
    now: () => new Date("2026-09-04T12:00:00.000Z"),
  });
}

function input(candidate = paypalCandidate(), providerMessageId = "paypal-message-1") {
  return {
    email: { from_address: "service@paypal.com", body: String(candidate.provider_reference_evidence || "") },
    candidate,
    providerMessageId,
    sourceIdentity: { senderAddress: "service@paypal.com", senderAuthentication: "pass" as const },
  };
}

describe("financial email income automation", () => {
  it("plans a grounded PayPal balance movement as automatic Cashback income", async () => {
    const plan = await planner()("u1", input());
    expect(plan).toMatchObject({
      candidateSemanticsVersion: 3,
      targetInferenceVersion: 6,
      candidate: {
        type: "income",
        payee: "Cashback",
        settlement_kind: "balance_to_bank",
        account_id: "savings",
        payee_id: "cashback",
        category_id: "cashback-category",
        transaction_import: { externalId: "TEST-TRANSFER-REF-0001", amountCents: 2225 },
      },
      classification: { documentKind: "income", eventKind: "account_transfer_pending" },
      operation: { intended: "create_transaction", kind: "create_transaction" },
      reconciliation: { status: "not_scheduled", disposition: "create" },
      automation: { operationClass: "income", rollout: "enabled", eligible: false },
    });
    expect(plan.candidate.transaction_import?.importedId).toMatch(/^financial-email:provider:v1:/);
  });

  it("converges lifecycle notices, preserves explicit provenance, and suppresses a manual duplicate", async () => {
    const pending = await planner()("u1", input());
    const completed = await planner()("u1", input(
      paypalCandidate({ event_kind: "account_transfer_completed" }),
      "paypal-message-2",
    ));
    expect(completed.candidate.transaction_import?.importedId)
      .toBe(pending.candidate.transaction_import?.importedId);

    const sale = await planner()("u1", input(paypalCandidate({
      payee: "/r/hardwareswap",
      provider_reference: "TEST-TRANSFER-REF-0002",
      provider_reference_evidence: "Transaction ID: TEST-TRANSFER-REF-0002",
    }), "paypal-message-sale"));
    expect(sale.candidate).toMatchObject({ type: "income", payee: "/r/hardwareswap", payee_id: "hardware" });
    expect(sale.targets.category.status).toBe("unresolved");

    const duplicate = await planner([manualCashback])("u1", input());
    expect(duplicate).toMatchObject({
      operation: { kind: "no_write" },
      reconciliation: { status: "already_recorded", disposition: "no_write", reason: "exact_transaction_match" },
    });
  });
});
