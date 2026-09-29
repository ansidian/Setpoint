import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createMigratedDb, queueEmail } from "../triage/triage-worker.test-utils.ts";
import { resolveFinancialEmailSeed } from "./financial-email-adoption-service.ts";
import type { BillCandidate, FinancialEmailPlan } from "../../shared/types/bills.ts";
import { FINANCIAL_CANDIDATE_SEMANTICS_VERSION } from "./bill-semantic-prompt.ts";
import { FINANCIAL_TARGET_INFERENCE_VERSION } from "./financialEmailTargetInference.ts";

const candidate: BillCandidate = {
  payee: "Costco", amount: 84.12, amount_kind: "order_total",
  event_kind: "purchase", event_confidence: 0.99, event_evidence: "warehouse order",
};

function reviewPlan(value: BillCandidate, key = "financial-email:v1:test"): FinancialEmailPlan {
  return {
    version: 1,
    profile: { status: "missing", budgetId: null, revision: 0, reason: "Review this entry and configure a profile." },
    candidateSemanticsVersion: FINANCIAL_CANDIDATE_SEMANTICS_VERSION,
    targetInferenceVersion: FINANCIAL_TARGET_INFERENCE_VERSION,
    identity: { version: 1, status: "resolved", key },
    candidate: value,
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 0.99, reasons: [] },
    operation: { intended: "create_transaction", kind: "review", reasons: ["account_target_unresolved"] },
    targets: {
      account: { kind: "account", status: "unresolved", provenance: [] },
      payee: { kind: "payee", status: "resolved", id: "payee-costco", label: "Costco", provenance: [] },
      category: { kind: "category", status: "not_applicable", provenance: [] },
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
  let dbClient: Client;
  const payload = () => ({ emailId: "msg-1", accountId: "gmail-work", dbClient });

  beforeEach(async () => {
    dbClient = await createMigratedDb();
  });
  afterEach(() => dbClient.close());

  async function storePlan(json: string | null) {
    await queueEmail(dbClient, { subject: "Your warehouse order", from_address: "orders@costco.com",
      body_text: "Your Costco warehouse order total is $84.12." });
    await dbClient.execute({
      sql: "UPDATE ea_email_triage SET bill_candidate_json = ?, financial_email_plan_json = ? WHERE user_id = ? AND email_id = ?",
      args: [JSON.stringify(candidate), json, "user-1", "msg-1"],
    });
  }

  async function storedPlanJson() {
    const rows = await dbClient.execute("SELECT financial_email_plan_json FROM ea_email_triage WHERE email_id = 'msg-1'");
    return rows.rows[0]?.financial_email_plan_json ?? null;
  }

  it("returns a valid historical plan unchanged without rewriting it", async () => {
    const stale = reviewPlan(candidate);
    stale.targetInferenceVersion = 2;
    delete stale.candidateSemanticsVersion;
    const json = JSON.stringify(stale);
    await storePlan(json);

    expect(await resolveFinancialEmailSeed("user-1", payload())).toEqual(stale);
    expect(await resolveFinancialEmailSeed("user-1", payload())).toEqual(stale);
    expect(await storedPlanJson()).toBe(json);
  });

  it.each([
    ["missing", null],
    ["malformed", "{not json"],
    ["invalid", JSON.stringify({ version: 1, identity: { version: 1 } })],
  ])("returns null for a %s stored plan without planning", async (_label, json) => {
    await storePlan(json);

    expect(await resolveFinancialEmailSeed("user-1", payload())).toBeNull();
    expect(await storedPlanJson()).toBe(json);
  });

  it("returns null without an email id, even for pasted content", async () => {
    expect(await resolveFinancialEmailSeed("user-1", {
      body: "Power bill total $42", candidate: { payee: "Power", amount: 42 }, source: "pasted_text", dbClient,
    })).toBeNull();
  });

  it("prefers the managed financial-event plan over a stored historical plan", async () => {
    await storePlan(JSON.stringify(reviewPlan(candidate)));
    // Mirrors the post-cutover arrival trigger that enrolls a managed financial document.
    await dbClient.execute(`INSERT INTO ea_financial_documents (user_id, account_id, email_uid, created_at, updated_at)
      VALUES ('user-1', 'gmail-work', 'msg-1', 1000, 1000)`);
    const managed = reviewPlan({ ...candidate, payee: "Managed Costco" }, "financial-event:managed");
    await dbClient.execute({
      sql: `INSERT INTO ea_financial_events (id, user_id, status, reason, created_at, updated_at, plan_json, collection_required)
            VALUES ('managed', 'user-1', 'needs_review', 'Review the details.', 1000, 1000, ?, 0)`,
      args: [JSON.stringify(managed)],
    });
    const associated = await dbClient.execute({
      sql: `UPDATE ea_financial_documents
            SET event_id = 'managed', status = 'associated', candidate_json = ?, processed_revision = revision
            WHERE user_id = 'user-1' AND email_uid = 'msg-1'`,
      args: [JSON.stringify(managed.candidate)],
    });
    expect(associated.rowsAffected).toBe(1);

    const result = await resolveFinancialEmailSeed("user-1", payload());

    expect(result).toMatchObject({ identity: { key: "financial-event:managed" }, candidate: { payee: "Managed Costco" } });
  });
});
