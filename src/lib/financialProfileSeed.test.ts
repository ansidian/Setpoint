import { describe, expect, it } from "vitest";
import type { FinancialEmailPlan, FinancialPlanTarget } from "../../shared/types/bills";
import { buildEmailFinancialProfileSeed, financialProfileSeedFromRouteState } from "./financialProfileSeed";

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
  it("starts a nonfinancial email with its exact sender and leaves financial decisions unset", () => {
    const seed = buildEmailFinancialProfileSeed({ uid: "approval", account_id: "gmail", from: '"Morgan Lee" <morgan@work.example>', subject: "Approve budget" }, {
      body: "Please approve the $30 budget by September 15.",
    });
    expect(seed).toEqual({ name: "Morgan Lee", senderAddresses: ["morgan@work.example"] });
  });

  it("keeps the source budget and resolved Actual IDs while excluding amount, date and body", () => {
    expect(buildEmailFinancialProfileSeed(email, {
      body: "Example Shop. Card ending 1234. Total $30 on September 15.", resolution: { key: "receiving-gmail:receipt", plan: plan() },
    })).toEqual({ name: "Example Shop", senderAddresses: ["receipts@shop.example"], merchantName: "Example Shop", accountLast4: "1234",
      budgetId: "source-budget", target: { kind: "expense", accountId: "actual-card", payeeId: "actual-shop" } });
  });

  it.each([false, true])("does not seed a scheduled-payment card identity from its funding suffix (destination supplied: %s)", destination => {
    const sourcePlan = plan();
    sourcePlan.candidate = { ...sourcePlan.candidate, type: "transfer", event_kind: "payment_scheduled",
      from_account_hint: "Savings ending 1234", from_account_hint_confidence: 0.99,
      account_last4_evidence: "Savings ending 1234",
      ...(destination ? { to_account_hint: "Rewards Card ending 9876", to_account_hint_confidence: 0.99 } : {}) };
    const seed = buildEmailFinancialProfileSeed(email, { body: "Payment from Savings ending 1234 to Rewards Card ending 9876.",
      resolution: { key: "receiving-gmail:receipt", plan: sourcePlan } });
    expect(seed.accountLast4).toBe(destination ? "9876" : undefined);
  });

  it.each(["key", "completion", "sender"])("does not borrow another message’s %s-bound suggestion", (mismatch) => {
    const sourcePlan = plan();
    if (mismatch === "completion") sourcePlan.workflow = { id: "other-event", state: "needs_review", relatedEmails: 1, reason: null, nextAttemptAt: null,
      completion: { emailUid: "other-receipt", documentRevision: 1, eventRevision: 1, canComplete: true } };
    if (mismatch === "sender") sourcePlan.profileSuggestion = { name: "Other", budgetId: "source-budget", senderAddresses: ["other@shop.example"], target: { kind: "expense", accountId: "other", payeeId: "other" } };
    const seed = buildEmailFinancialProfileSeed(email, { body: "Example Shop", resolution: { key: mismatch === "key" ? "receiving-gmail:other" : "receiving-gmail:receipt", plan: sourcePlan } });
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

  it("accepts partial navigation intent without importing persisted identity or enablement", () => {
    expect(financialProfileSeedFromRouteState({ financialProfileSeed: { senderAddresses: ["Bills@utility.example"],
      id: "injected-id", enabled: true, amount: 100, body: "Source text", date: "2026-09-15" } })).toEqual({ name: "", senderAddresses: ["bills@utility.example"] });
    expect(financialProfileSeedFromRouteState({ financialProfileSeed: { budgetId: "old-budget", senderAddresses: [], target: { kind: "utility" } } })).toEqual({ name: "", budgetId: "old-budget", senderAddresses: [], target: { kind: "utility", scheduleId: "" } });
  });


});
