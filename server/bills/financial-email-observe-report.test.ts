import { describe, expect, it } from "vitest";
import { createMigratedDb, queueEmail } from "../triage/triage-worker.test-utils.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import { readFinancialEmailObserveReport } from "./financial-email-observe-report.ts";

function plan(): FinancialEmailPlan {
  return {
    version: 1,
    identity: { version: 1, status: "resolved", key: "financial-email:v1:test" },
    candidate: { type: "expense", event_kind: "purchase", amount: 42 },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 1, reasons: [] },
    operation: { intended: "create_transaction", kind: "review", reasons: ["automation_class_observe_only"] },
    targets: {
      account: { kind: "account", status: "resolved", id: "account-1", provenance: [] },
      payee: { kind: "payee", status: "resolved", id: "payee-1", provenance: [] },
      category: { kind: "category", status: "resolved", id: "category-1", provenance: [] },
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
      gates: [{ gate: "rollout", status: "fail", reasons: ["automation_class_observe_only"] }],
      reasons: ["automation_class_observe_only"],
    },
  };
}

describe("financial email observe report", () => {
  it("reports a bounded redacted cohort without claiming write outcomes", async () => {
    const db = await createMigratedDb();
    await queueEmail(db);
    await db.execute({
      sql: "UPDATE ea_email_triage SET financial_email_plan_json = ? WHERE user_id = ? AND email_id = ?",
      args: [JSON.stringify(plan()), "user-1", "msg-1"],
    });

    await expect(readFinancialEmailObserveReport("user-1", { dbClient: db })).resolves.toEqual({
      writesEnabled: false,
      sampled: 1,
      invalid: 0,
      truncated: false,
      byOperationClass: expect.objectContaining({
        one_time_expense: {
          attempted: 1,
          eligible: 0,
          reviewed: 1,
          noWrite: 0,
          added: 0,
          updated: 0,
          duplicate: 0,
          failed: 0,
          unsafe: 0,
        },
      }),
    });
    await db.close();
  });

  it("counts malformed legacy plans separately instead of treating them as evidence", async () => {
    const db = await createMigratedDb();
    await queueEmail(db);
    await db.execute({
      sql: "UPDATE ea_email_triage SET financial_email_plan_json = '{\"version\":1}' WHERE user_id = 'user-1'",
      args: [],
    });

    await expect(readFinancialEmailObserveReport("user-1", { dbClient: db })).resolves.toMatchObject({
      sampled: 0,
      invalid: 1,
    });
    await db.close();
  });
});
