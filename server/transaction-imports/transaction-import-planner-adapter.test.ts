import { describe, expect, it, vi } from "vitest";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import {
  attachTransactionImportFinancialPlans,
  transactionImportPlannerInput,
} from "./transaction-import-planner-adapter.ts";
import type { InsertItemInput } from "./transaction-import-store.ts";
import { createFinancialEmailPlanner } from "../bills/financial-email-planner.ts";

function item(overrides: Partial<InsertItemInput> = {}): InsertItemInput {
  return {
    id: "item-1",
    runId: "run-1",
    userId: "owner-1",
    gmailAccountId: "gmail-1",
    gmailMessageId: "message-1",
    emailUid: "gmail-gmail-1-message-1",
    emailSubject: "You paid Example Store $25.99",
    internetMessageId: "<message-1@example.test>",
    candidateKey: "paypal-ABC123",
    source: "paypal",
    parserVersion: "paypal-v1",
    externalId: "ABC123",
    importedId: "paypal-ABC123",
    date: "2026-08-31",
    amountCents: -2599,
    currency: "USD",
    payee: "Example Store",
    notes: "PayPal transaction ABC123",
    actualAccountId: "mapped-account",
    actualCategoryId: "mapped-category",
    automationMode: "automatic",
    automaticSafe: true,
    blockingWarnings: [],
    evidence: [
      { code: "sender", value: "PayPal <service@paypal.com>" },
      {
        code: "sender_authentication",
        value: {
          version: 1,
          status: "pass",
          provider: "gmail",
          source: "gmail_authentication_results",
          headerFromDomain: "paypal.com",
          dkim: [{ result: "pass", domain: "paypal.com", aligned: true }],
          spf: null,
          dmarc: { result: "pass", domain: "paypal.com", aligned: true },
          evaluatedAt: "2026-08-31T12:00:00.000Z",
        },
      },
    ],
    status: "queued",
    ...overrides,
  };
}

function plan(candidate: FinancialEmailPlan["candidate"]): FinancialEmailPlan {
  return {
    version: 1,
    identity: { version: 1, status: "resolved", key: "financial-email:v1:test" },
    candidate: {
      ...candidate,
      event_evidence: "model excerpt must not persist",
      amount_candidates: [{ kind: "transaction_amount", value: 25.99, evidence: "body excerpt" }],
    },
    classification: {
      documentKind: "one_time_transaction",
      eventKind: "purchase",
      confidence: 1,
      evidence: "classification excerpt",
      reasons: [],
    },
    operation: { intended: "create_transaction", kind: "review", reasons: ["actual_preflight_not_run"] },
    targets: {
      account: {
        kind: "account",
        status: "resolved",
        id: "planned-account",
        label: "Card",
        provenance: [{ source: "actual_history", confidence: "high", reason: "Stable history", evidence: "history detail" }],
      },
      payee: { kind: "payee", status: "resolved", id: "payee-1", label: "Example Store", provenance: [] },
      category: { kind: "category", status: "resolved", id: "mapped-category", label: "Shopping", provenance: [] },
      fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
      toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
      schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
    },
    reconciliation: { status: "not_checked", disposition: "review", evidence: null },
    reviewReasons: [{ code: "actual_preflight_not_run", message: "Actual dry-run is required.", blocking: true }],
    automation: { eligible: false, operationClass: "one_time_expense", rollout: "observe_only", gates: [], reasons: ["actual_preflight_not_run"] },
  };
}

describe("transaction import financial planner adapter", () => {
  it("projects canonical parser output without allowing legacy mappings to affect planner input", () => {
    const mapped = transactionImportPlannerInput(item());
    const differentlyMapped = transactionImportPlannerInput(item({
      actualAccountId: "other-account",
      actualCategoryId: null,
      automationMode: "observe",
      blockingWarnings: [{ code: "missing_mapping", blocking: true }],
    }));

    expect(mapped).toEqual(differentlyMapped);
    expect(mapped).toMatchObject({
      providerMessageId: "paypal-ABC123",
      sourceIdentity: { senderAddress: "service@paypal.com", senderAuthentication: "pass" },
      candidate: {
        amount: 25.99,
        due_date: "2026-08-31",
        event_kind: "purchase",
        transaction_import: {
          externalId: "ABC123",
          importedId: "paypal-ABC123",
          amountCents: -2599,
          currency: "USD",
        },
      },
    });
  });

  it("preserves non-blocking parser warnings on the item without turning them into plan blockers", () => {
    const source = item({
      blockingWarnings: [{ code: "plain_text_fallback", blocking: false, detail: "HTML unavailable" }],
    });

    expect(source.blockingWarnings).toHaveLength(1);
    expect(transactionImportPlannerInput(source)?.candidate?.blocking_warnings).toEqual([]);
  });

  it("carries parser safety failures into the shared automation gates", () => {
    const untrusted = transactionImportPlannerInput(item({
      blockingWarnings: [{ code: "untrusted_sender", blocking: true, detail: "Sender mismatch" }],
    }));
    const missingIdentity = transactionImportPlannerInput(item({ externalId: null, importedId: null }));

    expect(untrusted).toMatchObject({
      sourceIdentity: { senderAuthentication: "fail" },
      candidate: { blocking_warnings: [{ code: "untrusted_sender", blocking: true }] },
    });
    expect(missingIdentity?.providerMessageId).toBeNull();
  });

  it("persists a redacted plan and a non-authoritative equivalence projection", async () => {
    const planner = vi.fn(async (_userId, input) => plan(input.candidate || {}));
    const result = (await attachTransactionImportFinancialPlans("owner-1", [item()], planner))[0]!;

    expect(result.actualAccountId).toBe("mapped-account");
    expect(result.financialPlan).toMatchObject({
      candidate: { amount: 25.99 },
      reconciliation: { status: "not_checked" },
    });
    expect(result.planShadow).toEqual({
      status: "planned",
      operation: "review",
      reconciliationStatus: "not_checked",
      account: { liveId: "mapped-account", plannedId: "planned-account", agreement: "mismatch" },
      category: { liveId: "mapped-category", plannedId: "mapped-category", agreement: "match" },
      automationEligible: false,
      automationReasons: ["actual_preflight_not_run"],
      failureCode: null,
    });
    expect(JSON.stringify(result.financialPlan)).not.toContain("excerpt");
    expect(JSON.stringify(result.financialPlan)).not.toContain("history detail");
  });

  it("resolves accepted source transactions from Actual history without source mappings", async () => {
    const planner = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "card-1", name: "Everyday Card", type: "credit" }],
        payees: [{ id: "example-store", name: "Example Store" }],
        payeeMap: { "example-store": "Example Store" },
        categories: [{ group_name: "Spending", categories: [{ id: "shopping", name: "Shopping" }] }],
        schedules: [],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T12:00:00.000Z" },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({
        transactions: [
          { id: "txn-1", date: "2026-08-01", amount: 25.99, direction: "expense", payee: "Example Store", payeeId: "example-store", category: "Shopping", account: "Everyday Card", accountId: "card-1", notes: "" },
          { id: "txn-2", date: "2026-07-01", amount: 18, direction: "expense", payee: "Example Store", payeeId: "example-store", category: "Shopping", account: "Everyday Card", accountId: "card-1", notes: "" },
        ],
      }),
      now: () => new Date("2026-09-01T12:00:00.000Z"),
    });

    const result = (await attachTransactionImportFinancialPlans("owner-1", [item({
      actualAccountId: null,
      actualCategoryId: null,
      blockingWarnings: [{ code: "missing_mapping", blocking: true }],
      status: "needs_review",
    })], planner))[0]!;

    expect(result.financialPlan).toMatchObject({
      operation: { intended: "create_transaction" },
      targets: {
        account: { status: "resolved", id: "card-1" },
        payee: { status: "resolved", id: "example-store" },
        category: { status: "resolved", id: "shopping" },
      },
    });
    expect(result.planShadow).toMatchObject({
      account: { liveId: null, plannedId: "card-1", agreement: "mismatch" },
      category: { liveId: null, plannedId: "shopping", agreement: "mismatch" },
      automationEligible: false,
    });
  });

  it("uses an exact Actual imported ID to prove targets and suppress a replayed duplicate", async () => {
    const planner = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "mapped-account", name: "Everyday Card", type: "credit" }],
        payees: [{ id: "example-store", name: "Example Store" }],
        payeeMap: { "example-store": "Example Store" },
        categories: [{ group_name: "Spending", categories: [{ id: "mapped-category", name: "Shopping" }] }],
        schedules: [],
        recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-09-01T12:00:00.000Z" },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({
        transactions: [{
          id: "actual-transaction-1",
          importedId: "paypal-ABC123",
          date: "2026-08-31",
          amount: 25.99,
          direction: "expense",
          payee: "Example Store",
          payeeId: "example-store",
          category: "Shopping",
          categoryId: "mapped-category",
          account: "Everyday Card",
          accountId: "mapped-account",
          notes: "",
        }],
      }),
      now: () => new Date("2026-09-01T12:00:00.000Z"),
    });

    const result = (await attachTransactionImportFinancialPlans("owner-1", [item()], planner))[0]!;

    expect(result.financialPlan).toMatchObject({
      operation: { intended: "create_transaction", kind: "no_write", reasons: ["already_recorded"] },
      targets: {
        account: { status: "resolved", id: "mapped-account" },
        payee: { status: "resolved", id: "example-store" },
        category: { status: "resolved", id: "mapped-category" },
      },
      reconciliation: { status: "already_recorded", disposition: "no_write" },
    });
    expect(result.planShadow).toMatchObject({
      account: { agreement: "match" },
      category: { agreement: "match" },
      automationEligible: false,
    });
  });

  it("keeps live import behavior available when planning fails", async () => {
    const result = (await attachTransactionImportFinancialPlans("owner-1", [item()], async () => {
      throw new Error("Actual unavailable");
    }))[0]!;

    expect(result).toMatchObject({
      actualAccountId: "mapped-account",
      actualCategoryId: "mapped-category",
      status: "queued",
      automaticSafe: true,
      financialPlan: null,
      planShadow: { status: "failed", failureCode: "planner_unavailable" },
    });
  });
});
