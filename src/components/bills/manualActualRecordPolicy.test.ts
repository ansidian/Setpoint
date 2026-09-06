import { describe, expect, it } from "vitest";
import type { FinancialEmailPlan } from "../../../shared/types/bills";
import { canCreateManualActualRecord } from "./manualActualRecordPolicy";

const plan = {
  operation: { kind: "no_write", intended: "no_write", reasons: [] },
  reconciliation: { status: "not_checked", disposition: "none" },
} as const;

describe("manual Actual record admission", () => {
  it("allows owner context to correct an automatic no-write assessment", () => {
    expect(canCreateManualActualRecord(plan)).toBe(true);
    expect(canCreateManualActualRecord(null)).toBe(false);
  });

  it.each<Partial<FinancialEmailPlan>>([
    { reconciliation: { status: "already_recorded" } },
    { reconciliation: { status: "already_scheduled" } },
    { reconciliation: { status: "needs_review" } },
    { reconciliation: { status: "not_checked", disposition: "no_write" } },
    { reconciliation: { status: "not_checked", disposition: "update_existing" } },
    { reconciliation: { status: "not_checked", evidence: { transactionId: "existing" } } },
    { reconciliation: { status: "not_checked", evidence: { scheduleId: "existing" } } },
    { reconciliation: { status: "not_checked", evidence: { transactionIds: ["possible"] } } },
    { reconciliation: { status: "not_checked", evidence: { scheduleIds: ["possible"] } } },
    { transferExecution: { budgetId: "budget", attemptedAt: "2026-09-06" } },
    { workflow: { id: "managed", state: "waiting", reason: "Waiting for details", relatedEmails: 1, nextAttemptAt: null } },
  ])("preserves an existing write or operation owner: %j", (existing) => {
    expect(canCreateManualActualRecord({ ...plan, ...existing })).toBe(false);
  });
});
