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
});
