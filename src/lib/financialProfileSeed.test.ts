import { describe, expect, it } from "vitest";
import type { FinancialEmailPlan, FinancialPlanTarget } from "../../shared/types/bills";
import { buildEmailFinancialProfileSeed } from "./financialProfileSeed";

const email = { uid: "receipt", account_id: "receiving-gmail", from_name: "Example Shop", from_address: "Receipts@shop.example", subject: "Your receipt" };
const target = (kind: FinancialPlanTarget["kind"], id?: string): FinancialPlanTarget => ({ kind, status: id ? "resolved" : "unresolved", id, provenance: [] });
function plan(): FinancialEmailPlan {
  return {
    version: 1, profile: { status: "missing", budgetId: "source-budget", revision: 2, reason: "Configure a profile" },
    identity: { version: 1, key: "source-plan", status: "resolved" },
    candidate: { type: "expense", payee: "Example Shop", amount: 30, due_date: "2026-09-15", account_last4: "1234",
      account_last4_evidence: "Card ending 1234", account_last4_confidence: 1 },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 1, reasons: [] },
    operation: { intended: "create_transaction", kind: "review", reasons: [] },
    targets: { account: target("account", "actual-card"), payee: target("payee", "actual-shop"), category: target("category"),
      fromAccount: target("from_account"), toAccount: target("to_account"), schedule: target("schedule") },
    reconciliation: { status: "not_checked" }, reviewReasons: [],
    automation: { eligible: false, operationClass: "one_time_expense", rollout: "enabled", gates: [], reasons: [] },
  };
}

describe("email profile editing seed", () => {
  it("keeps the source budget and resolved Actual IDs while excluding amount, date and body", () => {
    expect(buildEmailFinancialProfileSeed(email, {
      body: "Example Shop. Card ending 1234. Total $30 on September 15.", resolution: { key: "receiving-gmail:receipt", plan: plan() },
    })).toEqual({ name: "Example Shop", senderAddresses: ["receipts@shop.example"], merchantName: "Example Shop", accountLast4: "1234",
      budgetId: "source-budget", target: { kind: "expense", accountId: "actual-card", payeeId: "actual-shop" } });
  });

  it.each([
    { eventKind: "payment_scheduled", destination: false }, { eventKind: "payment_scheduled", destination: true },
    { eventKind: "statement_issued", destination: false }, { eventKind: "statement_issued", destination: true },
  ] as const)("keeps $eventKind card identity separate from funding (destination supplied: $destination)", ({ eventKind, destination }) => {
    const sourcePlan = plan();
    sourcePlan.candidate = { ...sourcePlan.candidate, type: "transfer", event_kind: eventKind,
      from_account_hint: "Savings ending 1234", from_account_hint_confidence: 0.99,
      account_last4_evidence: "Savings ending 1234",
      ...(destination ? { to_account_hint: "Rewards Card ending 9876", to_account_hint_confidence: 0.99 } : {}) };
    const seed = buildEmailFinancialProfileSeed(email, { body: "Payment from Savings ending 1234 to Rewards Card ending 9876.",
      resolution: { key: "receiving-gmail:receipt", plan: sourcePlan } });
    expect(seed.accountLast4).toBe(destination ? "9876" : undefined);
    expect(seed.target).toMatchObject({ kind: "card_payment" });
  });

  it("does not borrow another message’s suggestion", () => {
    const seed = buildEmailFinancialProfileSeed(email, { body: "Example Shop", resolution: { key: "receiving-gmail:other", plan: plan() } });
    expect(seed).toEqual({ name: "Example Shop", senderAddresses: ["receipts@shop.example"] });
  });

  it("leaves ambiguous and new-payee destinations empty and requires verbatim card evidence", () => {
    const sourcePlan = plan();
    sourcePlan.targets.account.competingCandidates = [{ key: "other", label: "Other card", confidence: "high", reason: "competing" }];
    sourcePlan.targets.payee = { ...target("payee"), status: "resolved", label: "Example Shop", provenance: [{ source: "source_adapter", confidence: "exact", reason: "grounded_new_payee" }] };
    const seed = buildEmailFinancialProfileSeed(email, { body: "Example Shop. Paid with card.", resolution: { key: "receiving-gmail:receipt", plan: sourcePlan } });
    expect(seed.target).toEqual({ kind: "expense", accountId: "", payeeId: "" });
    expect(seed.accountLast4).toBeUndefined();
  });
});
