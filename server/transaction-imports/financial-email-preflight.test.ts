import { describe, expect, it } from "vitest";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import {
  applyFinancialEmailPreflightOutcome,
  financialEmailPreflightItem,
} from "./financial-email-preflight.ts";

function exactPlan(): FinancialEmailPlan {
  return {
    version: 1,
    identity: { version: 1, status: "resolved", key: "financial-email:v1:opaque" },
    candidate: {
      payee: "Example Market",
      amount: 12.34,
      amount_kind: "transaction_amount",
      due_date: "2026-09-01",
      event_kind: "purchase",
      type: "expense",
      currency: "USD",
    },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 1, reasons: [] },
    operation: { intended: "create_transaction", kind: "create_transaction", reasons: [] },
    targets: {
      account: { kind: "account", status: "resolved", id: "account-1", label: "Checking", provenance: [] },
      payee: { kind: "payee", status: "resolved", id: "payee-1", label: "Example Market", provenance: [] },
      category: { kind: "category", status: "resolved", id: "category-1", label: "Groceries", provenance: [] },
      fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
      toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
      schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
    },
    reconciliation: { status: "not_checked", disposition: "review" },
    reviewReasons: [],
    automation: {
      eligible: false,
      operationClass: "one_time_expense",
      rollout: "observe_only",
      gates: [
        "semantic", "canonical_amount", "date", "targets", "authenticity", "stable_identity", "warnings",
      ].map((gate) => ({ gate, status: "pass", reasons: [] })) as FinancialEmailPlan["automation"]["gates"],
      reasons: ["actual_preflight_not_run", "automation_class_observe_only"],
    },
  };
}

describe("generic financial email preflight staging", () => {
  it.each([
    ["auto-confirm@amazon.com", "Ordered: Coffee"],
    ["service@paypal.com", "You paid $12.34 to Example Market"],
  ])("leaves %s receipts to their deterministic import owner", (emailFrom, emailSubject) => {
    expect(financialEmailPreflightItem("user-1", "run-1", "item-1", {
      accountId: "gmail-work", emailId: "message-1", emailFrom, emailSubject,
    }, exactPlan())).toBeNull();
  });
  it("projects an exact expense into an observe-only durable item", () => {
    const item = financialEmailPreflightItem(
      "user-1",
      "run-1",
      "item-1",
      { accountId: "gmail-work", emailId: "message-1", emailSubject: "Receipt" },
      exactPlan(),
    );
    expect(item).toMatchObject({
      source: "generic",
      importedId: "financial-email:v1:opaque",
      amountCents: -1234,
      actualAccountId: "account-1",
      actualCategoryId: "category-1",
      automationMode: "observe",
      automaticSafe: false,
      status: "queued",
    });
  });

  it("projects income with positive cents and provider identity", () => {
    const plan = exactPlan();
    plan.candidate = {
      ...plan.candidate,
      payee: "Cashback",
      type: "income",
      event_kind: "reward",
      provider_reference: "TEST-SC-0001",
      transaction_import: {
        source: "generic",
        parserVersion: "financial-email-semantics-v2",
        executionOwner: "planner",
        externalId: "TEST-SC-0001",
        importedId: "financial-email:provider:v1:cashback",
        amountCents: 1234,
        currency: "USD",
      },
    };
    plan.classification = { documentKind: "income", eventKind: "reward", confidence: 1, reasons: [] };
    plan.targets.payee = { kind: "payee", status: "resolved", id: "cashback", label: "Cashback", provenance: [] };
    plan.targets.category = { kind: "category", status: "resolved", id: "cashback-category", label: "Cashback", provenance: [] };
    plan.automation.operationClass = "income";

    expect(financialEmailPreflightItem(
      "user-1", "run-1", "item-1",
      { accountId: "gmail-work", emailId: "message-1" },
      plan,
    )).toMatchObject({
      externalId: "TEST-SC-0001",
      importedId: "financial-email:provider:v1:cashback",
      amountCents: 1234,
      payee: "Cashback",
      notes: "Provider reference: TEST-SC-0001",
      actualCategoryId: "cashback-category",
    });
  });

  it("refuses staging when any locked prerequisite gate has not passed", () => {
    const plan = exactPlan();
    plan.automation.gates = plan.automation.gates.map((gate) => (
      gate.gate === "authenticity" ? { ...gate, status: "fail" } : gate
    ));
    expect(financialEmailPreflightItem(
      "user-1", "run-1", "item-1",
      { accountId: "gmail-work", emailId: "message-1" },
      plan,
    )).toBeNull();
  });

  it("does not send a known reconciliation conflict to Actual preview", () => {
    const plan = exactPlan();
    plan.automation.gates.push({
      gate: "reconciliation",
      status: "fail",
      reasons: ["reconciliation_conflict"],
    });
    expect(financialEmailPreflightItem(
      "user-1", "run-1", "item-1",
      { accountId: "gmail-work", emailId: "message-1" },
      plan,
    )).toBeNull();
  });

  it.each(["already_recorded", "already_scheduled"] as const)(
    "does not stage a %s no-write plan even when reconciliation passes",
    (status) => {
      const plan = exactPlan();
      plan.operation = { intended: "create_transaction", kind: "no_write", reasons: [status] };
      plan.reconciliation = { status, disposition: "no_write", reason: "exact_transaction_match" };
      plan.automation.gates.push({ gate: "reconciliation", status: "pass", reasons: [] });
      expect(financialEmailPreflightItem(
        "user-1", "run-1", "item-1",
        { accountId: "gmail-work", emailId: "message-1" },
        plan,
      )).toBeNull();
    },
  );

  it("records a successful Actual preview while retaining the observe-only rollout lock", () => {
    const plan = exactPlan();
    plan.automation.gates.push(
      { gate: "reconciliation", status: "unknown", reasons: ["reconciliation_unavailable"] },
      { gate: "actual_preflight", status: "unknown", reasons: ["actual_preflight_not_run"] },
      { gate: "rollout", status: "fail", reasons: ["automation_class_observe_only"] },
    );
    const result = applyFinancialEmailPreflightOutcome(plan, "would_add", "2026-09-01T22:00:00.000Z");
    expect(result).toMatchObject({
      reconciliation: { status: "not_scheduled", disposition: "create" },
      automation: {
        eligible: false,
        rollout: "observe_only",
        reasons: ["automation_class_observe_only"],
      },
    });
    expect(result.automation.gates).toContainEqual({ gate: "actual_preflight", status: "pass", reasons: [] });
    expect(result.automation.gates).toContainEqual({ gate: "reconciliation", status: "pass", reasons: [] });
  });

  it("turns an exact imported-ID duplicate into a no-write plan", () => {
    const result = applyFinancialEmailPreflightOutcome(exactPlan(), "already_present", "2026-09-01T22:00:00.000Z");
    expect(result.operation).toEqual({
      intended: "create_transaction",
      kind: "no_write",
      reasons: ["already_recorded"],
    });
    expect(result.reconciliation).toMatchObject({ status: "already_recorded", disposition: "no_write" });
  });

  it("does not let an import preview replace a missing current-Actual duplicate check", () => {
    const plan = exactPlan();
    plan.automation.rollout = "enabled";
    plan.automation.gates.push(
      { gate: "reconciliation", status: "unknown", reasons: ["reconciliation_unavailable"] },
      { gate: "actual_preflight", status: "unknown", reasons: ["actual_preflight_not_run"] },
      { gate: "rollout", status: "pass", reasons: [] },
    );
    const result = applyFinancialEmailPreflightOutcome(plan, "would_add", "2026-09-01T22:00:00.000Z");
    expect(result.reconciliation.status).toBe("not_checked");
    expect(result.automation.eligible).toBe(false);
    expect(result.automation.reasons).toEqual(["reconciliation_unavailable"]);
  });
});
