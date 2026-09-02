import { describe, expect, it } from "vitest";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import type { InsertItemInput } from "./transaction-import-store.ts";
import { summarizeTransactionImportEquivalence } from "./transaction-import-equivalence-report.ts";

function item(overrides: Partial<InsertItemInput> = {}): InsertItemInput {
  return {
    id: "item-1",
    runId: "run-1",
    userId: "owner-1",
    gmailAccountId: "gmail-1",
    gmailMessageId: "message-1",
    emailUid: "email-1",
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
    actualAccountId: "account-1",
    actualCategoryId: null,
    automationMode: "automatic",
    automaticSafe: true,
    blockingWarnings: [],
    evidence: [{ code: "sender", value: "service@paypal.com" }],
    status: "added",
    ...overrides,
  };
}

function plan(source: InsertItemInput, kind: "no_write" | "review"): FinancialEmailPlan {
  return {
    version: 1,
    identity: { version: 1, status: "resolved", key: `financial-email:v1:${source.id}` },
    candidate: {
      payee: source.payee || undefined,
      amount: Math.abs(source.amountCents || 0) / 100,
      due_date: source.date,
      notes: source.notes,
      event_kind: "purchase",
      type: "expense",
      transaction_import: {
        source: source.source,
        parserVersion: source.parserVersion,
        externalId: source.externalId,
        importedId: source.importedId,
        amountCents: source.amountCents!,
        currency: source.currency,
      },
    },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 1, reasons: [] },
    operation: {
      intended: "create_transaction",
      kind,
      reasons: kind === "no_write" ? ["already_recorded"] : ["account_target_unresolved"],
    },
    targets: {
      account: kind === "no_write"
        ? { kind: "account", status: "resolved", id: "account-1", label: "Card", provenance: [] }
        : { kind: "account", status: "unresolved", provenance: [] },
      payee: { kind: "payee", status: "resolved", id: "payee-1", label: "Example Store", provenance: [] },
      category: { kind: "category", status: "unresolved", provenance: [] },
      fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
      toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
      schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
    },
    reconciliation: kind === "no_write"
      ? { status: "already_recorded", disposition: "no_write" }
      : { status: "not_checked", disposition: "review" },
    reviewReasons: [],
    automation: {
      eligible: false,
      operationClass: "one_time_expense",
      rollout: "observe_only",
      gates: [],
      reasons: ["automation_class_observe_only"],
    },
  };
}

function planned(source: InsertItemInput, kind: "no_write" | "review"): InsertItemInput {
  const financialPlan = plan(source, kind);
  return {
    ...source,
    financialPlan,
    planShadow: {
      status: "planned",
      operation: kind,
      reconciliationStatus: financialPlan.reconciliation.status,
      account: {
        liveId: source.actualAccountId || null,
        plannedId: kind === "no_write" ? "account-1" : null,
        agreement: kind === "no_write" ? "match" : "unresolved",
      },
      category: { liveId: null, plannedId: null, agreement: "unresolved" },
      automationEligible: false,
      automationReasons: ["automation_class_observe_only"],
      failureCode: null,
    },
  };
}

describe("transaction import equivalence policy", () => {
  it("accepts live duplicate suppression, tombstone containment, and a malformed review item", () => {
    const live = item();
    const deleted = item({ id: "item-2", importedId: "paypal-DEF456", externalId: "DEF456" });
    const review = item({
      id: "item-3",
      importedId: null,
      externalId: null,
      date: null,
      amountCents: null,
      payee: null,
      status: "needs_review",
    });
    const report = summarizeTransactionImportEquivalence(
      [live, deleted, review],
      [
        planned(live, "no_write"),
        planned(deleted, "review"),
        {
          ...review,
          financialPlan: null,
          planShadow: {
            status: "not_plannable",
            operation: null,
            reconciliationStatus: null,
            account: { liveId: "account-1", plannedId: null, agreement: "unresolved" },
            category: { liveId: null, plannedId: null, agreement: "unresolved" },
            automationEligible: false,
            automationReasons: [],
            failureCode: "canonical_fields_missing",
          },
        },
      ],
      {
        "paypal-ABC123": { importedId: "paypal-ABC123", tombstoned: false, accountId: "account-1", categoryId: null },
        "paypal-DEF456": { importedId: "paypal-DEF456", tombstoned: true, accountId: "account-1", categoryId: null },
      },
    );

    expect(report).toMatchObject({
      writesEnabled: false,
      canonical: { plannable: 2, preserved: 2, containedReview: 1 },
      reconciliation: {
        committed: 2,
        current: 1,
        tombstoned: 1,
        missing: 0,
        duplicateSuppressed: 1,
        tombstonesContained: 1,
        reviewContained: 1,
      },
      automation: { contained: 3, eligible: 0, unsafe: 0 },
      discrepancies: [],
      passed: true,
    });
  });

  it("fails closed when a committed imported ID is absent from Actual history", () => {
    const source = item();
    const report = summarizeTransactionImportEquivalence([source], [planned(source, "review")]);

    expect(report.passed).toBe(false);
    expect(report.reconciliation.missing).toBe(1);
    expect(report.discrepancies[0]?.codes).toContain("actual_commit_missing");
  });
});
