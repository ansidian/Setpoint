import { describe, expect, it } from "vitest";
import { createFinancialEmailPlanner, selectSemanticBillAmount } from "./financial-email-planner.ts";
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

describe("financial email planner contract", () => {
  it.each([
    ["purchase", "one_time_transaction", "create_transaction"],
    ["refund", "income", "create_transaction"],
    ["reward", "income", "create_transaction"],
  ] as const)("classifies %s without collapsing intended action into review", async (eventKind, documentKind, intended) => {
    const result = await planner()("u1", { candidate: candidate(eventKind) });

    expect(result).toMatchObject({
      version: 1,
      classification: { documentKind, eventKind },
      operation: { intended, kind: "review" },
      targets: {
        account: { status: "unresolved" },
        payee: { status: "unresolved" },
        category: { status: "unresolved" },
      },
      automation: { eligible: false },
    });
  });

  it("distinguishes recurring utility bills from one-time bill events", async () => {
    const plan = planner();
    const recurring = await plan("u1", {
      candidate: candidate("bill_issued", { type: "bill" }),
    });
    const oneTime = await plan("u1", {
      candidate: candidate("bill_issued", { type: "expense", due_date: null }),
    });

    expect(recurring).toMatchObject({
      classification: { documentKind: "utility_statement" },
      operation: { intended: "create_schedule", kind: "review" },
    });
    expect(oneTime).toMatchObject({
      classification: { documentKind: "one_time_transaction" },
      operation: { intended: "create_transaction", kind: "review" },
    });
  });

  it("requires corroborating credit-account evidence for a credit-card statement", async () => {
    const plan = planner();
    const corroborated = await plan("u1", {
      candidate: candidate("statement_issued", {
        type: "transfer",
        account_last4: "4242",
        account_last4_confidence: 0.98,
        account_last4_evidence: "Card ending in 4242",
      }),
    });
    const uncorroborated = await plan("u1", {
      candidate: candidate("statement_issued", { type: "transfer" }),
    });

    expect(corroborated).toMatchObject({
      classification: { documentKind: "credit_card_statement", reasons: [] },
      operation: { intended: "create_transfer_schedule", kind: "review" },
    });
    expect(uncorroborated).toMatchObject({
      classification: {
        documentKind: "informational",
        reasons: ["credit_account_evidence_missing"],
      },
      operation: { intended: null, kind: "review" },
    });
  });

  it.each(["payment_cancelled", "payment_failed"] as const)("makes %s informational and no-write", async (eventKind) => {
    const result = await planner()("u1", {
      candidate: candidate(eventKind, { amount: null, amount_kind: null, amount_candidates: [], due_date: null }),
    });

    expect(result).toMatchObject({
      classification: { documentKind: "informational" },
      operation: { intended: "no_write", kind: "no_write" },
      reviewReasons: [],
      targets: {
        account: { status: "not_applicable" },
        schedule: { status: "not_applicable" },
      },
    });
  });

  it("returns an ambiguous event as a successful review plan", async () => {
    const result = await planner()("u1", { candidate: candidate("other") });

    expect(result).toMatchObject({
      classification: { documentKind: "informational", reasons: ["semantic_event_ambiguous"] },
      operation: { intended: null, kind: "review" },
      automation: { eligible: false },
    });
  });

  it("never selects a minimum-due-only amount", async () => {
    const result = await planner()("u1", {
      candidate: candidate("payment_due", {
        type: "bill", type_confidence: 0.99, type_evidence: "Utility payment due",
        amount: 25,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 25, confidence: 0.99 }],
      }),
    });

    expect(result.operation).toMatchObject({ kind: "review" });
    expect(result.reviewReasons.map((item) => item.code)).toContain("minimum_due_only");
    expect(result.automation.gates.find((item) => item.gate === "canonical_amount")).toEqual({
      gate: "canonical_amount",
      status: "fail",
      reasons: ["minimum_due_only"],
    });
  });

  it("selects statement balance over another selected amount", () => {
    const result = selectSemanticBillAmount(candidate("statement_issued", {
      amount: 40,
      amount_kind: "payment_amount",
      amount_candidates: [
        { kind: "payment_amount", value: 40, confidence: 0.99 },
        { kind: "statement_balance", value: 391.2, confidence: 0.9 },
      ],
    }));

    expect(result).toMatchObject({ amount: 391.2, kind: "statement_balance" });
  });

  it("keeps an invalid calendar date out of an actionable plan", async () => {
    const result = await planner()("u1", {
      candidate: candidate("purchase", { due_date: "2026-02-31" }),
    });

    expect(result.reviewReasons.map((item) => item.code)).toContain("due_date_invalid");
    expect(result.automation.gates.find((item) => item.gate === "date")).toEqual({
      gate: "date",
      status: "fail",
      reasons: ["due_date_invalid"],
    });
  });

  it("does not call extraction or verification for a persisted complete candidate", async () => {
    const plan = createFinancialEmailPlanner({
      candidateExtractor: async () => {
        throw new Error("unexpected first-pass extraction");
      },
      candidateVerification: {
        verifyEmailCandidate: async () => {
          throw new Error("unexpected provider verification");
        },
      },
      metadataReader: async () => ({
        accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: null },
      }),
      occurrenceReader: async () => ({ schedules: [] }),
      transactionReader: async () => ({ transactions: [] }),
      now: fixedNow,
    });

    const result = await plan("u1", { candidate: candidate("purchase") });

    expect(result.classification.documentKind).toBe("one_time_transaction");
    expect(result.reviewReasons.map((item) => item.code)).not.toContain("provider_unavailable");
  });

  it("converts verification failure into a reviewable plan", async () => {
    const plan = createFinancialEmailPlanner({
      candidateVerification: {
        verifyEmailCandidate: async () => {
          throw new Error("provider down");
        },
      },
      modelChoiceReader: async () => ({ provider: "openai", model: "fixture" }),
      metadataReader: async () => ({
        accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: null },
      }),
      occurrenceReader: async () => ({ schedules: [] }),
      transactionReader: async () => ({ transactions: [] }),
      now: fixedNow,
    });
    const result = await plan("u1", {
      email: { subject: "Statement", body: "A statement is available." },
      candidate: { payee: "Example", event_kind: null, semantic_enrichment: undefined },
    });

    expect(result.operation.kind).toBe("review");
    expect(result.reviewReasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      "provider_unavailable",
      "semantic_event_missing",
    ]));
  });

  it("does not silently no-write a low-confidence cancellation when verification fails", async () => {
    const plan = createFinancialEmailPlanner({
      candidateVerification: {
        verifyEmailCandidate: async () => {
          throw new Error("provider down");
        },
      },
      modelChoiceReader: async () => ({ provider: "openai", model: "fixture" }),
      metadataReader: async () => ({
        accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: null },
      }),
      occurrenceReader: async () => ({ schedules: [] }),
      transactionReader: async () => ({ transactions: [] }),
      now: fixedNow,
    });
    const result = await plan("u1", {
      email: { body: "Your payment was cancelled." },
      candidate: candidate("payment_cancelled", {
        event_confidence: 0.4,
        semantic_enrichment: undefined,
      }),
    });

    expect(result.operation).toMatchObject({ intended: "no_write", kind: "review" });
    expect(result.reviewReasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      "provider_unavailable",
      "semantic_event_ambiguous",
    ]));
  });

  it("maps an exact existing schedule to no-write with its Actual targets resolved", async () => {
    const plan = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "acct-1", name: "Checking" }],
        payees: [{ id: "payee-1", name: "Power Co" }],
        payeeMap: { "payee-1": "Power Co" },
        categories: [],
        schedules: [{
          id: "schedule-1",
          name: "Power Co",
          next_date: "2026-09-10",
          type: "bill",
          conditions: [
            { field: "payee", op: "is", value: "payee-1" },
            { field: "account", op: "is", value: "acct-1" },
            { field: "amount", op: "is", value: -4225 },
          ],
        }],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      occurrenceReader: async () => ({
        schedules: [{
          id: "occurrence-1",
          scheduleId: "schedule-1",
          name: "Power Co",
          amount: 42.25,
          next_date: "2026-09-10",
          type: "bill",
          paid: false,
        }],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      transactionReader: async () => ({ transactions: [] }),
      now: fixedNow,
    });
    const result = await plan("u1", {
      candidate: candidate("bill_issued", {
        type: "bill",
        payee: "Power Co",
        payee_id: "payee-1",
        account_id: "acct-1",
      }),
    });

    expect(result).toMatchObject({
      operation: { intended: "create_schedule", kind: "no_write", reasons: ["already_scheduled"] },
      reconciliation: { status: "already_scheduled", reason: "exact_schedule_match" },
      targets: {
        account: { status: "resolved", id: "acct-1", label: "Checking" },
        payee: { status: "resolved", id: "payee-1", label: "Power Co" },
        schedule: { status: "resolved", id: "schedule-1", label: "Power Co" },
      },
    });
    expect(result.reviewReasons).toEqual([]);
  });

  it.each(["payment_completed", "purchase"] as const)("maps an exact %s transaction to no-write", async (eventKind) => {
    const plan = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "acct-1", name: "Checking" }],
        payees: [{ id: "payee-1", name: "Power Co" }],
        payeeMap: { "payee-1": "Power Co" },
        categories: [],
        schedules: [],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      occurrenceReader: async () => ({
        schedules: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      transactionReader: async () => ({
        transactions: [{
          id: "transaction-1",
          date: "2026-08-30",
          amount: 42.25,
          direction: "expense",
          payee: "Power Co",
          payeeId: "payee-1",
          category: "Utilities",
          account: "Checking",
          accountId: "acct-1",
          notes: "",
        }],
      }),
      now: fixedNow,
    });
    const result = await plan("u1", {
      candidate: candidate(eventKind, {
        type: "expense",
        payee: "Power Co",
        payee_id: "payee-1",
        account_id: "acct-1",
        due_date: "2026-08-30",
      }),
    });

    expect(result).toMatchObject({
      operation: { intended: "create_transaction", kind: "no_write", reasons: ["already_recorded"] },
      reconciliation: { status: "already_recorded", reason: "exact_transaction_match" },
    });
    expect(result.reviewReasons).toEqual([]);
  });

  it("keeps a completed card payment without grounded type evidence in review", async () => {
    const result = await planner()("u1", {
      candidate: candidate("card_payment_completed", { type: "transfer" }),
    });

    expect(result).toMatchObject({
      classification: { documentKind: "credit_card_statement" },
      operation: { intended: null, kind: "review" },
    });
    expect(result.reviewReasons.map((item) => item.code)).toContain("semantic_event_ambiguous");
  });

  it("creates a utility schedule from Actual metadata and stable history", async () => {
    const plan = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "checking", name: "Household Checking 1111", type: "checking" }],
        payees: [{ id: "power", name: "Power Co" }],
        payeeMap: { power: "Power Co" },
        categories: [{ group_name: "Bills", categories: [{ id: "utilities", name: "Utilities" }] }],
        schedules: [],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({
        transactions: [
          { id: "t1", date: "2026-08-01", amount: 42.25, direction: "expense", payee: "Power Co", payeeId: "power", category: "Utilities", account: "Household Checking 1111", accountId: "checking", notes: "" },
          { id: "t2", date: "2026-07-01", amount: 42.25, direction: "expense", payee: "Power Co", payeeId: "power", category: "Utilities", account: "Household Checking 1111", accountId: "checking", notes: "" },
        ],
      }),
      now: fixedNow,
    });
    const result = await plan("u1", {
      candidate: candidate("bill_issued", { type: "bill", payee: "Power Co" }),
    });

    expect(result.operation).toEqual({ intended: "create_schedule", kind: "create_schedule", reasons: [] });
    expect(result.targets).toMatchObject({
      account: { status: "resolved", id: "checking" },
      payee: { status: "resolved", id: "power" },
      category: { status: "resolved", id: "utilities" },
      schedule: { status: "resolved", label: "Power Co" },
    });
    expect(result.reconciliation).toMatchObject({ status: "not_scheduled", disposition: "create" });
    expect(result.automation.eligible).toBe(false);
  });

  it("creates a merchant transaction from stable direction-aware history", async () => {
    const plan = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "card", name: "Everyday Card 4242", type: "credit" }],
        payees: [{ id: "acme", name: "Acme" }],
        payeeMap: { acme: "Acme" },
        categories: [{ group_name: "Spending", categories: [{ id: "shopping", name: "Shopping" }] }],
        schedules: [],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({
        transactions: [
          { id: "t1", date: "2026-08-01", amount: 42.25, direction: "expense", payee: "Acme", payeeId: "acme", category: "Shopping", account: "Everyday Card 4242", accountId: "card", notes: "" },
          { id: "t2", date: "2026-07-01", amount: 42.25, direction: "expense", payee: "Acme", payeeId: "acme", category: "Shopping", account: "Everyday Card 4242", accountId: "card", notes: "" },
        ],
      }),
      now: fixedNow,
    });

    const result = await plan("u1", { candidate: candidate("purchase", { payee: "Acme" }) });
    expect(result.operation).toEqual({ intended: "create_transaction", kind: "create_transaction", reasons: [] });
    expect(result.targets).toMatchObject({
      account: { status: "resolved", id: "card" },
      payee: { status: "resolved", id: "acme" },
      category: { status: "resolved", id: "shopping" },
    });
  });

  it("creates a transfer schedule only when both Actual account sides resolve", async () => {
    const plan = createFinancialEmailPlanner({
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
    const result = await plan("u1", {
      candidate: candidate("statement_issued", {
        type: "transfer",
        payee: "Everyday Card",
        account_last4: "4242",
        account_last4_confidence: 0.99,
        account_last4_evidence: "Card ending in 4242",
      }),
    });

    expect(result.operation).toEqual({ intended: "create_transfer_schedule", kind: "create_transfer_schedule", reasons: [] });
    expect(result.targets).toMatchObject({
      fromAccount: { status: "resolved", id: "checking" },
      toAccount: { status: "resolved", id: "card" },
      schedule: { status: "resolved", label: "Everyday Card 4242 Payment" },
      category: { status: "not_applicable" },
    });
  });

  it("represents a safe same-schedule amount change as update_existing without adding an operation kind", async () => {
    const plan = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "checking", name: "Checking" }],
        payees: [{ id: "power", name: "Power Co" }],
        payeeMap: { power: "Power Co" },
        categories: [{ group_name: "Bills", categories: [{ id: "utilities", name: "Utilities" }] }],
        schedules: [{
          id: "power-schedule",
          name: "Power Co",
          next_date: "2026-09-10",
          type: "bill",
          conditions: [
            { field: "payee", op: "is", value: "power" },
            { field: "account", op: "is", value: "checking" },
            { field: "amount", op: "is", value: -5000 },
          ],
        }],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T11:00:00.000Z" },
      }),
      occurrenceReader: async () => ({
        schedules: [{ scheduleId: "power-schedule", name: "Power Co", amount: 50, next_date: "2026-09-10", type: "bill", paid: false }],
        syncHealth: { state: "current" },
      }),
      transactionReader: async () => ({
        transactions: [
          { id: "t1", date: "2026-08-01", amount: 42.25, direction: "expense", payee: "Power Co", payeeId: "power", category: "Utilities", account: "Checking", accountId: "checking", notes: "" },
          { id: "t2", date: "2026-07-01", amount: 42.25, direction: "expense", payee: "Power Co", payeeId: "power", category: "Utilities", account: "Checking", accountId: "checking", notes: "" },
        ],
      }),
      now: fixedNow,
    });
    const result = await plan("u1", {
      candidate: candidate("bill_issued", { type: "bill", payee: "Power Co" }),
    });

    expect(result.reconciliation).toMatchObject({
      status: "needs_review",
      reason: "amount_mismatch",
      disposition: "update_existing",
      evidence: { scheduleId: "power-schedule", conflicts: ["amount"] },
    });
    expect(result.operation).toEqual({ intended: "create_schedule", kind: "create_schedule", reasons: [] });
    expect(result.reviewReasons).toEqual([]);
  });

  it("keeps target conflicts and degraded Actual metadata in review", async () => {
    const conflicted = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "checking", name: "Checking 1111" }, { id: "card", name: "Card 4242" }],
        payees: [{ id: "acme", name: "Acme" }],
        payeeMap: { acme: "Acme" }, categories: [], recentTransactions: [],
        schedules: [{ id: "s1", name: "Acme", next_date: "2026-09-10", type: "bill", conditions: [{ field: "payee", value: "acme" }, { field: "account", value: "checking" }] }],
        syncHealth: { state: "current", lastSuccessAt: null },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({ transactions: [] }), now: fixedNow,
    });
    const conflictResult = await conflicted("u1", {
      candidate: candidate("bill_issued", { type: "bill", payee: "Acme", account_last4: "4242", account_last4_confidence: 0.99, account_last4_evidence: "ending in 4242" }),
    });
    expect(conflictResult.operation.kind).toBe("review");
    expect(conflictResult.reviewReasons.map((item) => item.code)).toContain("target_evidence_conflict");

    const degraded = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
        syncHealth: { state: "unavailable", lastSuccessAt: null },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "unavailable" } }),
      transactionReader: async () => ({ transactions: [] }), now: fixedNow,
    });
    const degradedResult = await degraded("u1", { candidate: candidate("purchase") });
    expect(degradedResult.operation.kind).toBe("review");
    expect(degradedResult.reviewReasons.map((item) => item.code)).toContain("actual_metadata_unavailable");
  });

  it("rejects malformed caller input instead of returning a plan", async () => {
    await expect(planner()("u1", {})).rejects.toThrow("email body or persisted candidate is required");
  });
});
