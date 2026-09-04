import { describe, expect, it, vi } from "vitest";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillCandidate, FinancialEmailClassification } from "../../shared/types/bills.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";
import { inferFinancialEmailTargets } from "./financialEmailTargetInference.ts";

function metadata(overrides: Partial<ActualMetadata> = {}): ActualMetadata {
  return {
    accounts: [
      { id: "checking", name: "Household Checking 1111", type: "checking" },
      { id: "card", name: "Everyday Card 4242", type: "credit" },
    ],
    payees: [{ id: "acme", name: "Acme" }],
    payeeMap: { acme: "Acme", "transfer-card": "Everyday Card 4242" },
    categories: [{ group_name: "Spending", categories: [{ id: "shopping", name: "Shopping" }] }],
    schedules: [],
    recentTransactions: [],
    ...overrides,
  };
}

function classification(
  documentKind: FinancialEmailClassification["documentKind"] = "one_time_transaction",
): FinancialEmailClassification {
  return { documentKind, eventKind: "purchase", confidence: 0.99, reasons: [] };
}

function candidate(overrides: BillCandidate = {}): BillCandidate {
  return { payee: "Acme", event_kind: "purchase", ...overrides };
}

function transaction(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: "txn-1",
    date: "2026-08-01",
    amount: 42.25,
    direction: "expense",
    payee: "Acme",
    payeeId: "acme",
    category: "Shopping",
    account: "Household Checking 1111",
    accountId: "checking",
    notes: "",
    ...overrides,
  };
}

describe("inferFinancialEmailTargets", () => {
  it("lets a unique trusted suffix beat a single contrary history row", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Card ending in 4242",
      }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata(),
      history: [transaction()],
    });

    expect(result.targets.account).toMatchObject({ status: "resolved", id: "card" });
    expect(result.targets.account.competingCandidates).toHaveLength(2);
    expect(result.reasons).not.toContain("target_evidence_conflict");
  });

  it("keeps one purchase-history row as a non-selectable competitor", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({ payee: "Merchant Without Metadata" }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata({ payees: [], payeeMap: {} }),
      history: [transaction({ payee: "Merchant Without Metadata", payeeId: "merchant" })],
    });

    expect(result.targets.account).toMatchObject({ status: "unresolved" });
    expect(result.targets.account.competingCandidates).toHaveLength(1);
    expect(result.targets.payee).toMatchObject({ status: "unresolved" });
    expect(result.targets.payee.competingCandidates).toHaveLength(1);
  });

  it("keeps duplicate suffix matches unresolved", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "ending in 4242",
      }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata({
        accounts: [
          { id: "card-a", name: "Card A 4242" },
          { id: "card-b", name: "Card B 4242" },
        ],
      }),
    });

    expect(result.targets.account.status).toBe("unresolved");
    expect(result.targets.account.competingCandidates).toHaveLength(2);
    expect(result.reasons).toContain("target_evidence_conflict");
  });

  it("surfaces a conflict between a suffix and an exact schedule account", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        type: "bill",
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "ending in 4242",
      }),
      classification: classification("utility_statement"),
      intended: "create_schedule",
      metadata: metadata({
        schedules: [{
          id: "acme-schedule",
          name: "Acme",
          type: "bill",
          conditions: [
            { field: "account", value: "checking" },
            { field: "payee", value: "acme" },
          ],
        }],
      }),
    });

    expect(result.targets.account.status).toBe("unresolved");
    expect(result.reasons).toContain("target_evidence_conflict");
  });

  it("resolves a utility schedule and its conditional category history", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({ type: "bill" }),
      classification: classification("utility_statement"),
      intended: "create_schedule",
      metadata: metadata({
        schedules: [{
          id: "acme-schedule",
          name: "Acme",
          type: "bill",
          conditions: [
            { field: "account", value: "checking" },
            { field: "payee", value: "acme" },
          ],
        }],
      }),
      history: [transaction(), transaction({ id: "txn-2", date: "2026-07-01" })],
    });

    expect(result.targets).toMatchObject({
      account: { status: "resolved", id: "checking" },
      payee: { status: "resolved", id: "acme" },
      category: { status: "resolved", id: "shopping" },
      schedule: { status: "resolved", id: "acme-schedule" },
    });
  });

  it("uses direction-aware stable history for purchases and refunds", async () => {
    const expenseRows = [transaction(), transaction({ id: "txn-2", date: "2026-07-01" })];
    const incomeRows = [
      transaction({ id: "refund-1", direction: "income", accountId: "card", account: "Everyday Card 4242" }),
      transaction({ id: "refund-2", date: "2026-07-01", direction: "income", accountId: "card", account: "Everyday Card 4242" }),
    ];
    const result = await inferFinancialEmailTargets({
      candidate: candidate({ event_kind: "refund" }),
      classification: { ...classification("income"), eventKind: "refund" },
      intended: "create_transaction",
      metadata: metadata(),
      history: [...expenseRows, ...incomeRows],
    });

    expect(result.targets.account).toMatchObject({ status: "resolved", id: "card" });
    expect(result.targets.payee).toMatchObject({ status: "resolved", id: "acme" });
  });

  it("maps grounded cash-back rewards to a unique Cashback payee", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        payee: "Chase Ultimate Rewards",
        event_kind: "reward",
        event_confidence: 0.99,
        event_evidence: "$60.00 cash back",
      }),
      classification: { ...classification("income"), eventKind: "reward" },
      intended: "create_transaction",
      metadata: metadata({
        payees: [{ id: "cashback", name: "Cashback" }],
        payeeMap: { cashback: "Cashback" },
      }),
    });

    expect(result.targets.payee).toMatchObject({
      status: "resolved",
      id: "cashback",
      label: "Cashback",
      provenance: [expect.objectContaining({ reason: "semantic_reward_payee" })],
    });
  });

  it("keeps a cash-back reward unresolved when Cashback payees are ambiguous", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({ event_kind: "reward", event_evidence: "$60.00 cash back" }),
      classification: { ...classification("income"), eventKind: "reward" },
      intended: "create_transaction",
      metadata: metadata({
        payees: [
          { id: "cashback-1", name: "Cashback" },
          { id: "cashback-2", name: "Cash Back" },
        ],
        payeeMap: { "cashback-1": "Cashback", "cashback-2": "Cash Back" },
      }),
    });

    expect(result.targets.payee.status).toBe("unresolved");
  });

  it("routes a statement-credit reward to the source card", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        payee: "Chase Ultimate Rewards",
        event_kind: "reward",
        event_confidence: 0.99,
        event_evidence: "Cash amount $19.32",
        settlement_kind: "statement_credit",
        settlement_confidence: 0.99,
        settlement_evidence: "Order number TEST-SC-0001",
        account_last4: "0002",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Account ending in 0002",
      }),
      classification: { ...classification("income"), eventKind: "reward" },
      intended: "create_transaction",
      metadata: metadata({
        accounts: [
          { id: "savings", name: "Example Savings (0001)", type: "savings" },
          { id: "chase", name: "Example Rewards Card (0002)", type: "credit" },
        ],
        payees: [{ id: "cashback", name: "Cashback" }],
        payeeMap: { cashback: "Cashback" },
        categories: [{ group_name: "Income", categories: [{ id: "cashback-category", name: "Cashback" }] }],
      }),
    });

    expect(result.targets).toMatchObject({
      account: { status: "resolved", id: "chase" },
      payee: { status: "resolved", id: "cashback" },
      category: { status: "resolved", id: "cashback-category" },
    });
  });

  it("routes a bank-deposit reward to stable Cashback bank history instead of the source card", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        payee: "Chase Ultimate Rewards",
        event_kind: "reward",
        event_confidence: 0.99,
        event_evidence: "Cash amount $60.00",
        settlement_kind: "bank_deposit",
        settlement_confidence: 0.99,
        settlement_evidence: "Order number TEST-BD-0001",
        account_last4: "0003",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Account ending in 0003",
      }),
      classification: { ...classification("income"), eventKind: "reward" },
      intended: "create_transaction",
      metadata: metadata({
        accounts: [
          { id: "savings", name: "Example Savings (0001)", type: "savings" },
          { id: "prime", name: "Example Travel Card (0003)", type: "credit" },
        ],
        payees: [{ id: "cashback", name: "Cashback" }],
        payeeMap: { cashback: "Cashback" },
        categories: [{ group_name: "Income", categories: [{ id: "cashback-category", name: "Cashback" }] }],
      }),
      history: [
        transaction({ id: "cashback-1", direction: "income", payee: "Cashback", payeeId: "cashback", category: "Cashback", categoryId: "cashback-category", account: "Example Savings (0001)", accountId: "savings" }),
        transaction({ id: "cashback-2", date: "2026-07-01", direction: "income", payee: "Cashback", payeeId: "cashback", category: "Cashback", categoryId: "cashback-category", account: "Example Savings (0001)", accountId: "savings" }),
      ],
    });

    expect(result.targets.account).toMatchObject({
      status: "resolved",
      id: "savings",
      provenance: [expect.objectContaining({ reason: "stable_cashback_bank_destination" })],
    });
  });

  it("does not treat partially identified history as fully consistent", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({ payee: "Merchant Without Metadata" }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata({ payees: [], payeeMap: {} }),
      history: [
        transaction({ payee: "Merchant Without Metadata", payeeId: "merchant" }),
        transaction({ id: "txn-2", payee: "Merchant Without Metadata", payeeId: null }),
      ],
    });

    expect(result.targets.account.status).toBe("unresolved");
    expect(result.targets.payee.status).toBe("unresolved");
  });

  it("resolves transfer topology from a trusted suffix and exact transfer schedule", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        event_kind: "statement_issued",
        schedule_name: "Everyday Card 4242 Payment",
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Card ending in 4242",
      }),
      classification: { ...classification("credit_card_statement"), eventKind: "statement_issued" },
      intended: "create_transfer_schedule",
      metadata: metadata({
        schedules: [{
          id: "card-payment",
          name: "Everyday Card 4242 Payment",
          type: "transfer",
          transferAccountId: "checking",
          conditions: [
            { field: "account", value: "card" },
            { field: "payee", value: "transfer-card" },
            { field: "amount", op: "is", value: 4225 },
          ],
        }],
      }),
    });

    expect(result.targets).toMatchObject({
      fromAccount: { status: "resolved", id: "checking" },
      toAccount: { status: "resolved", id: "card" },
      schedule: { status: "resolved", id: "card-payment" },
      category: { status: "not_applicable" },
    });
  });

  it("keeps one transfer-history source as a non-selectable competitor", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        event_kind: "statement_issued",
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Card ending in 4242",
      }),
      classification: { ...classification("credit_card_statement"), eventKind: "statement_issued" },
      intended: "create_transfer_schedule",
      metadata: metadata(),
      history: [transaction({ transferAccountId: "card" })],
    });

    expect(result.targets.toAccount).toMatchObject({ status: "resolved", id: "card" });
    expect(result.targets.fromAccount).toMatchObject({ status: "unresolved" });
    expect(result.targets.fromAccount.competingCandidates).toHaveLength(1);
  });

  it("uses the model only to choose among coherent history bundles", async () => {
    const rankBundles = vi.fn(async ({ options }) => ({
      status: "selected" as const,
      key: options[1]!.key,
      confidence: 0.91,
      evidence: "household card",
    }));
    const result = await inferFinancialEmailTargets({
      candidate: candidate(),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata(),
      history: [
        transaction(),
        transaction({ id: "txn-2", accountId: "card", account: "Everyday Card 4242" }),
      ],
      rankBundles,
    });

    expect(result.targets.account).toMatchObject({ status: "resolved", id: "card" });
    expect(result.targets.account.provenance[0]).toMatchObject({ source: "model_ranking" });
  });

  it("semantically resolves a bank merchant descriptor from repeated compatible Actual history", async () => {
    const rankBundles = vi.fn(async ({ options }) => ({
      status: "selected" as const,
      key: options[0]!.key,
      confidence: 0.98,
      evidence: "EXAMPLE MARKET",
    }));
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        payee: undefined,
        payee_hint: "EXAMPLE MARKET #100 TEST CITY",
        account_last4: "0004",
        account_last4_confidence: 1,
        account_last4_evidence: "Card Ending In 0004",
      }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata({
        accounts: [{ id: "market-card", name: "Example Rewards Card 0004", type: "credit" }],
        payees: [{ id: "market", name: "Example Market" }],
        payeeMap: { market: "Example Market" },
      }),
      history: [
        transaction({ id: "market-1", payee: "Example Market", payeeId: "market", account: "Example Rewards Card 0004", accountId: "market-card" }),
        transaction({ id: "market-2", date: "2026-07-01", payee: "Example Market", payeeId: "market", account: "Example Rewards Card 0004", accountId: "market-card" }),
      ],
      rankBundles,
    });

    expect(result.targets.account).toMatchObject({ status: "resolved", id: "market-card" });
    expect(result.targets.payee).toMatchObject({
      status: "resolved",
      id: "market",
      label: "Example Market",
      provenance: [expect.objectContaining({ source: "model_ranking" })],
    });
    expect(result.candidate).toMatchObject({ payee: "Example Market", payee_id: "market" });
  });

  it("does not offer a non-exact payee without repeated compatible history", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({ payee: undefined, payee_hint: "ACME STORE #104" }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata(),
      history: [transaction()],
      rankBundles: async () => ({ status: "selected", key: "option_1", confidence: 0.99, evidence: "ACME" }),
    });

    expect(result.targets.payee.status).toBe("unresolved");
  });

  it("keeps a corroborated non-exact payee unresolved when semantic ranking fails", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({ payee: undefined, payee_hint: "ACME STORE #104" }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata(),
      history: [transaction(), transaction({ id: "txn-2", date: "2026-07-01" })],
      rankBundles: async () => ({ status: "unresolved", key: null, confidence: 0.72, evidence: "ACME" }),
    });

    expect(result.targets.payee.status).toBe("unresolved");
    expect(result.reasons).toContain("target_ranking_unresolved");
  });

  it("constrains non-exact payee history to the uniquely matched account suffix", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate({
        payee: undefined,
        payee_hint: "ACME STORE #104",
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Card ending in 4242",
      }),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata(),
      history: [
        transaction({ accountId: "card", account: "Everyday Card 4242" }),
        transaction({ id: "txn-2", date: "2026-07-01", accountId: "card", account: "Everyday Card 4242" }),
        transaction({ id: "other-1", accountId: "checking", account: "Household Checking 1111" }),
        transaction({ id: "other-2", date: "2026-07-01", accountId: "checking", account: "Household Checking 1111" }),
      ],
      rankBundles: async ({ options }) => options.length === 1
        && options[0]!.description === "Everyday Card 4242 · Acme"
        ? { status: "selected", key: options[0]!.key, confidence: 0.97, evidence: "ACME" }
        : { status: "unresolved", key: null, confidence: null, evidence: null },
    });

    expect(result.targets.account).toMatchObject({ status: "resolved", id: "card" });
    expect(result.targets.payee).toMatchObject({ status: "resolved", id: "acme" });
  });

  it("allows constrained ranking to resolve competing category bundles", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate(),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata({
        categories: [{
          group_name: "Spending",
          categories: [
            { id: "shopping", name: "Shopping" },
            { id: "travel", name: "Travel" },
          ],
        }],
      }),
      history: [
        transaction(),
        transaction({ id: "txn-2", category: "Travel" }),
      ],
      rankBundles: async ({ options }) => ({
        status: "selected",
        key: options.find((option) => option.description.endsWith("Travel"))!.key,
        confidence: 0.92,
        evidence: "travel purchase",
      }),
    });

    expect(result.targets.account).toMatchObject({ status: "resolved", id: "checking" });
    expect(result.targets.payee).toMatchObject({ status: "resolved", id: "acme" });
    expect(result.targets.category).toMatchObject({ status: "resolved", id: "travel" });
  });

  it("keeps competing history bundles unresolved when ranking fails", async () => {
    const result = await inferFinancialEmailTargets({
      candidate: candidate(),
      classification: classification(),
      intended: "create_transaction",
      metadata: metadata(),
      history: [
        transaction(),
        transaction({ id: "txn-2", accountId: "card", account: "Everyday Card 4242" }),
      ],
      rankBundles: async () => ({ status: "unresolved", key: null, confidence: null, evidence: null }),
    });

    expect(result.targets.account.status).toBe("unresolved");
    expect(result.reasons).toContain("target_ranking_unresolved");
  });
});
