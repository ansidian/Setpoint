import { readImportRun, savedImportFixture } from './transaction-import.test-utils.ts';
import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { createTransactionImportStore } from "./transaction-import-store.ts";
import { stageFinancialEmailPreflight } from "./financial-email-preflight.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";

function genericPlan(): FinancialEmailPlan {
  return {
    version: 1, identity: { version: 1, status: "resolved", key: "financial-email:legacy" },
    candidate: { type: "expense", payee: "Example Market", amount: 12, amount_kind: "transaction_amount", due_date: "2026-07-21", event_kind: "purchase", currency: "USD" },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 1, reasons: [] },
    operation: { intended: "create_transaction", kind: "create_transaction", reasons: [] },
    targets: {
      account: { kind: "account", status: "resolved", id: "card", provenance: [] },
      payee: { kind: "payee", status: "resolved", id: "market", label: "Example Market", provenance: [] },
      category: { kind: "category", status: "not_applicable", provenance: [] },
      fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
      toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
      schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
    },
    reconciliation: { status: "not_scheduled", disposition: "create" }, reviewReasons: [],
    automation: {
      eligible: false, operationClass: "one_time_expense", rollout: "enabled", reasons: ["actual_preflight_not_run"],
      gates: ["semantic", "canonical_amount", "date", "targets", "profile", "authenticity", "stable_identity", "warnings", "reconciliation", "rollout"]
        .map((gate) => ({ gate, status: "pass", reasons: [] })) as FinancialEmailPlan["automation"]["gates"],
    },
  };
}

describe("financial event source ownership", () => {
  let db: Client;

  beforeEach(async () => {
    db = await createMigratedDb();
    await db.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2026-07-01T00:00:00Z'");
    await db.execute("INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at) VALUES (1, 'owner-1', 'hash', 1)");
    await db.execute("INSERT INTO ea_accounts (id, user_id, type, email, label) VALUES ('gmail-1', 'owner-1', 'gmail', 'owner@example.test', 'Mail')");
  });
  afterEach(() => db.close());

  async function capture(uid: string, date = "2026-07-21T17:30:00Z"): Promise<void> {
    await db.execute({
      sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email,
              from_address, subject, body_text, email_date, email_date_utc, indexed_at)
            VALUES (?, 'owner-1', 'gmail-1', 'Mail', 'owner@example.test', ?, ?, ?, ?, ?, '2026-07-21T17:31:00Z')`,
      args: [uid, "receipts@market.example.test", "Market receipt", "Purchase $12", date, date],
    });
  }

  function setup() { return { store: createTransactionImportStore(db) }; }

  it("blocks generic legacy staging for managed mail and keeps older manual staging available", async () => {
    const { store } = setup();
    await capture("managed");
    await capture("legacy", "2026-06-01T00:00:00Z");
    expect(await stageFinancialEmailPreflight("owner-1", { accountId: "gmail-1", emailId: "managed" }, genericPlan(), store))
      .toEqual({ staged: false, runId: null });
    const old = await stageFinancialEmailPreflight("owner-1", { accountId: "gmail-1", emailId: "legacy" }, genericPlan(), store);
    expect(old.staged).toBe(true);
    expect((await readImportRun(db, store, "owner-1", old.runId!))?.items).toMatchObject([{ emailUid: "legacy", status: "queued" }]);
  });
  it("does not stage unknown historical mail after provider activation", async () => {
    const { store } = setup();
    await capture("historical", "2026-06-01T00:00:00Z");
    await db.execute("UPDATE ea_financial_workflow_state SET provider_parser_cutover_at = '2026-09-16T03:02:18.469Z'");
    expect(await stageFinancialEmailPreflight("owner-1", { accountId: "gmail-1", emailId: "historical" }, genericPlan(), store))
      .toEqual({ staged: false, runId: null });
    expect(await store.listItemsForEmail("owner-1", "historical")).toEqual([]);
    expect((await db.execute("SELECT COUNT(*) AS count FROM ea_transaction_import_runs")).rows[0]?.count).toBe(0);
    expect((await db.execute("SELECT cutover_at FROM ea_financial_workflow_state")).rows[0]?.cutover_at).toBe("2026-07-01T00:00:00Z");
  });
  it("atomically rejects new legacy rows after activation and retains unsubmitted history", async () => {
    const { store } = setup();
    await store.createRun({ id: "saved-run", userId: "owner-1", trigger: "arrival", optionsKey: "saved", gmailAccountIds: ["gmail-1"], sources: ["amazon"] });
    await store.insertItem(savedImportFixture({ id: "saved", runId: "saved-run", status: "failed" }));
    await db.execute("UPDATE ea_financial_workflow_state SET provider_parser_cutover_at = '2026-09-16T03:02:18.469Z'");
    expect(await store.createRun({ id: "new-run", userId: "owner-1", trigger: "arrival", optionsKey: "new", gmailAccountIds: ["gmail-1"], sources: ["amazon"] })).toBeNull();
    expect(await store.insertItem(savedImportFixture({ id: "new", runId: "saved-run", candidateKey: "new" }))).toBe(false);
    expect(await store.retryItem("owner-1", "saved")).toBe(false);
    expect(await store.confirmItem("owner-1", "saved-run", "saved", { date: "2026-07-21", amountCents: -2704, payee: "Amazon", notes: "", actualAccountId: "card", actualCategoryId: null })).toBe(false);
    expect(await store.claimNextItem("worker")).toBeNull();
    expect(await store.getItem("owner-1", "saved")).toMatchObject({ status: "failed", executionEligible: false, importedId: "amazon-111-2222222-3333333" });
    expect((await store.listItemsForEmail("owner-1", "gmail-personal-msg-1"))[0]).toMatchObject({ executionEligible: false, status: "failed" });
    expect((await store.readDashboardActivity("owner-1")).reviewCount).toBe(0);
  });

  it.each(["original", "transfer", "confirmed"])("retains %s recovery authority across activation", async (authority) => {
    const { store } = setup();
    await store.createRun({ id: "saved-run", userId: "owner-1", trigger: "arrival", optionsKey: "saved", gmailAccountIds: ["gmail-1"], sources: ["amazon"] });
    const plan = genericPlan();
    if (authority === "transfer") plan.transferExecution = { budgetId: "saved-budget", attemptedAt: "2026-09-01T00:00:00Z" };
    await store.insertItem(savedImportFixture({ id: "saved", runId: "saved-run", status: "failed", financialPlan: plan }));
    if (authority === "original") await db.execute(`UPDATE ea_transaction_import_items SET original_attempted_at=123, prepared_actual_json='{"budgetId":"saved-budget","objects":[]}' WHERE id='saved'`);
    if (authority === "confirmed") await db.execute("UPDATE ea_transaction_import_items SET confirmed_at=123 WHERE id='saved'");
    await db.execute("UPDATE ea_financial_workflow_state SET provider_parser_cutover_at = '2026-09-16T03:02:18.469Z'");
    if (authority !== "confirmed") expect(await store.confirmItem("owner-1", "saved-run", "saved", { date: "2026-07-21", amountCents: -9999, payee: "Changed", notes: "", actualAccountId: "other-card", actualCategoryId: null })).toBe(false);
    expect((await store.readDashboardActivity("owner-1")).reviewCount).toBe(1);
    expect(await store.retryItem("owner-1", "saved")).toBe(true);
    expect(await store.claimNextItem("recovery")).toMatchObject({ id: "saved", amountCents: -2704 });
    expect(await store.getItem("owner-1", "saved")).toMatchObject({ executionEligible: true, amountCents: -2704,
      ...(authority === "original" ? { originalAttemptedAt: 123, preparedEvidence: { budgetId: "saved-budget", objects: [] } } : {}),
      ...(authority === "transfer" ? { financialPlan: { transferExecution: plan.transferExecution } } : {}),
    });
  });

});
