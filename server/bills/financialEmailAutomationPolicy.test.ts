import { describe, expect, it } from "vitest";
import { financialEmailAutomationEligibility } from "./financialEmailAutomationPolicy.ts";
import type { BillCandidate, FinancialEmailInput, FinancialIntendedOperationKind } from "../../shared/types/bills.ts";

function eligibility(
  input: FinancialEmailInput = {},
  candidate: BillCandidate = { type: "expense", event_kind: "purchase", currency: "USD" },
  intended: FinancialIntendedOperationKind = "create_transaction",
) {
  return financialEmailAutomationEligibility({
    input: {
      providerMessageId: "message-1",
      sourceIdentity: { senderAuthentication: "pass" },
      actualPreflight: { status: "passed" },
      ...input,
    },
    candidate,
    evidence: [],
    targets: [],
    reconciliation: { status: "not_scheduled", disposition: "create" },
    intended,
  });
}

describe("financial email automation policy", () => {
  it("enables owner-authorized one-time expenses after every runtime gate passes", () => {
    expect(eligibility()).toEqual({
      eligible: true,
      operationClass: "one_time_expense",
      rollout: "enabled",
      gates: expect.arrayContaining([
        { gate: "actual_preflight", status: "pass", reasons: [] },
        { gate: "rollout", status: "pass", reasons: [] },
      ]),
      reasons: [],
    });
  });

  it.each([
    ["authentication", { sourceIdentity: { senderAuthentication: "unavailable" } }, "sender_authentication_unavailable"],
    ["stable identity", { providerMessageId: null }, "stable_identity_missing"],
    ["Actual preflight", { actualPreflight: { status: "not_run" as const } }, "actual_preflight_not_run"],
  ])("fails the %s gate explicitly", (_label, input, reason) => {
    const result = eligibility(input as FinancialEmailInput);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it("enables owner-authorized income after every runtime gate passes", () => {
    const result = eligibility({}, { type: "income", event_kind: "refund", currency: "USD" });
    expect(result).toMatchObject({
      eligible: true,
      operationClass: "income",
      rollout: "enabled",
    });
  });

  it.each([
    { intended: "create_transfer" as const, operationClass: "completed_transfer", type: "transfer", event_kind: "card_payment_completed" as const },
    { intended: "create_schedule" as const, operationClass: "utility_schedule", type: "bill", event_kind: "bill_issued" as const },
  ])("enables $operationClass after all runtime gates pass", ({ intended, operationClass, ...candidate }) => {
    expect(eligibility({}, { ...candidate, currency: "USD" }, intended)).toMatchObject({
      eligible: true, operationClass, rollout: "enabled",
    });
    expect(eligibility({}, { ...candidate, currency: null }, intended)).toMatchObject({
      eligible: false, reasons: expect.arrayContaining(["blocking_warning"]),
    });
  });

  it("never lets a blocking warning pass through an otherwise complete plan", () => {
    const result = eligibility({}, {
      type: "expense",
      event_kind: "purchase",
      blocking_warnings: [{ code: "unsupported_currency", blocking: true }],
    });
    expect(result.gates).toContainEqual({ gate: "warnings", status: "fail", reasons: ["blocking_warning"] });
  });

  it("blocks contradictory event/type semantics even when upstream evidence gates are empty", () => {
    const result = eligibility({}, { type: "expense", event_kind: "card_payment_completed", event_confidence: 0.99, type_confidence: 0.99, currency: "USD" }, "create_transfer");
    expect(result.eligible).toBe(false);
    expect(result.gates).toContainEqual({ gate: "semantic", status: "fail", reasons: ["semantic_event_ambiguous"] });
  });

  it.each([null, "EUR", "CAD"])("keeps %s currency out of unattended USD imports", (currency) => {
    const result = eligibility({}, { type: "expense", event_kind: "purchase", currency });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("blocking_warning");
  });
});
