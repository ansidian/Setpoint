import { describe, expect, it, vi } from "vitest";
import { createMigratedDb, queueEmail } from "../triage/triage-worker.test-utils.ts";
import { resolveFinancialEmailSeed } from "./financial-email-adoption-service.ts";
import type { BillCandidate, FinancialEmailPlan } from "../../shared/types/bills.ts";

function reviewPlan(candidate: BillCandidate): FinancialEmailPlan {
  return {
    version: 1,
    identity: { version: 1, status: "resolved", key: "financial-email:v1:test" },
    candidate: { ...candidate, payee: "Costco" },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 0.99, reasons: [] },
    operation: { intended: "create_transaction", kind: "review", reasons: ["account_target_unresolved"] },
    targets: {
      account: { kind: "account", status: "unresolved", provenance: [] },
      payee: { kind: "payee", status: "resolved", id: "payee-costco", label: "Costco", provenance: [] },
      category: { kind: "category", status: "resolved", id: "warehouse", label: "Warehouse", provenance: [] },
      fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
      toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
      schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
    },
    reconciliation: { status: "not_checked", disposition: "review" },
    reviewReasons: [{ code: "account_target_unresolved", message: "Choose an account.", field: "account", blocking: true }],
    automation: { eligible: false, operationClass: "one_time_expense", rollout: "observe_only", gates: [], reasons: ["account_target_unresolved"] },
  };
}

describe("resolveFinancialEmailSeed", () => {
  it("persists a planned triage candidate once and reuses the complete plan", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Your warehouse order",
      body_snippet: "Order total $84.12",
      body_text: "Your Costco warehouse order total is $84.12.",
      from_name: "Costco",
      from_address: "orders@costco.com",
    });
    const candidate = {
      payee_hint: "Costco",
      amount: 84.12,
      amount_kind: "order_total" as const,
      event_kind: "purchase" as const,
      event_confidence: 0.99,
      event_evidence: "warehouse order",
    };
    await dbClient.execute({
      sql: "UPDATE ea_email_triage SET bill_candidate_json = ? WHERE user_id = ? AND account_id = ? AND email_id = ?",
      args: [JSON.stringify(candidate), "user-1", "gmail-work", "msg-1"],
    });
    const planner = vi.fn(async (_userId: string, input: { candidate?: BillCandidate | null }) => reviewPlan(input.candidate || {}));

    const first = await resolveFinancialEmailSeed(
      "user-1",
      { emailId: "msg-1", accountId: "gmail-work", dbClient },
      { planner: planner as never },
    );
    const second = await resolveFinancialEmailSeed(
      "user-1",
      { emailId: "msg-1", accountId: "gmail-work", dbClient },
      { planner: planner as never },
    );
    const stored = await dbClient.execute({
      sql: "SELECT bill_candidate_json, financial_email_plan_json FROM ea_email_triage WHERE email_id = ?",
      args: ["msg-1"],
    });

    expect(second).toEqual(first);
    expect(JSON.parse(String(stored.rows[0]!.bill_candidate_json))).toEqual(first.candidate);
    expect(JSON.parse(String(stored.rows[0]!.financial_email_plan_json))).toEqual(first);
    // test-architecture: allow-boundary-interaction -- planner invocation is the outbound AI/Actual read boundary; durable plan reuse is observable only by proving the second resolution avoided that boundary.
    expect(planner).toHaveBeenCalledTimes(1);
    await dbClient.close();
  });

  it("plans pasted content without attempting triage persistence", async () => {
    const dbClient = await createMigratedDb();
    const candidate = { payee_hint: "Power", amount: 42 };
    const planner = vi.fn(async () => reviewPlan(candidate));

    const result = await resolveFinancialEmailSeed(
      "user-1",
      { body: "Power bill total $42", candidate, source: "pasted_text", dbClient },
      { planner: planner as never },
    );

    expect(result.candidate).toMatchObject({ payee: "Costco", amount: 42 });
    const rows = await dbClient.execute("SELECT financial_email_plan_json FROM ea_email_triage");
    expect(rows.rows).toHaveLength(0);
    await dbClient.close();
  });
});
