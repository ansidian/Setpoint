import { describe, expect, it } from "vitest";
import { financialEmailAutomationEligibility } from "./financialEmailAutomationPolicy.ts";
import type { BillCandidate, FinancialEmailInput } from "../../shared/types/bills.ts";

function eligibility(
  input: FinancialEmailInput = {},
  candidate: BillCandidate = { type: "expense", event_kind: "purchase" },
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
    intended: "create_transaction",
  });
}

describe("financial email automation policy", () => {
  it("keeps otherwise safe one-time expenses observe-only until cohort evidence enables the class", () => {
    expect(eligibility()).toEqual({
      eligible: false,
      operationClass: "one_time_expense",
      rollout: "observe_only",
      gates: expect.arrayContaining([
        { gate: "actual_preflight", status: "pass", reasons: [] },
        { gate: "rollout", status: "fail", reasons: ["automation_class_observe_only"] },
      ]),
      reasons: ["automation_class_observe_only"],
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

  it("classifies positive-direction candidates as income while retaining the observe gate", () => {
    const result = eligibility({}, { type: "income", event_kind: "refund" });
    expect(result).toMatchObject({
      eligible: false,
      operationClass: "income",
      rollout: "observe_only",
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
});
