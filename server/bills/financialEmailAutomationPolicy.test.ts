import { describe, expect, it } from "vitest";
import { financialEmailAutomationEligibility } from "./financialEmailAutomationPolicy.ts";
import type { BillCandidate, FinancialEmailInput } from "../../shared/types/bills.ts";

function eligibility(
  input: FinancialEmailInput = {},
  candidate: BillCandidate = { type: "expense", event_kind: "purchase", currency: "USD" },
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

  it.each([null, "EUR", "CAD"])("keeps %s currency out of unattended USD imports", (currency) => {
    const result = eligibility({}, { type: "expense", event_kind: "purchase", currency });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("blocking_warning");
  });
});
