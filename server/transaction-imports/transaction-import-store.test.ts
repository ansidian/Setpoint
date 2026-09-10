import { readImportRun } from './transaction-import.test-utils.ts';
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import { createTransactionImportStore, type InsertItemInput } from "./transaction-import-store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");


function savedPlan(): FinancialEmailPlan {
  return {
    version: 1 as const,
    identity: { version: 1 as const, status: "resolved" as const, key: "financial-email:v1:test" },
    candidate: { payee: "Amazon", amount: 25.99, event_kind: "purchase" as const },
    classification: { documentKind: "one_time_transaction" as const, eventKind: "purchase" as const, confidence: 1, reasons: [] },
    operation: { intended: "create_transaction" as const, kind: "review" as const, reasons: ["actual_preflight_not_run" as const] },
    targets: {
      account: { kind: "account" as const, status: "resolved" as const, id: "planned-account", provenance: [] },
      payee: { kind: "payee" as const, status: "resolved" as const, id: "amazon-payee", provenance: [] },
      category: { kind: "category" as const, status: "unresolved" as const, provenance: [] },
      fromAccount: { kind: "from_account" as const, status: "not_applicable" as const, provenance: [] },
      toAccount: { kind: "to_account" as const, status: "not_applicable" as const, provenance: [] },
      schedule: { kind: "schedule" as const, status: "not_applicable" as const, provenance: [] },
    },
    reconciliation: { status: "not_checked" as const, disposition: "review" as const },
    reviewReasons: [],
    automation: { eligible: false, operationClass: "one_time_expense" as const, rollout: "observe_only" as const, gates: [], reasons: ["actual_preflight_not_run" as const] },
  };
}

describe("transaction import store", () => {
  let db: Client;
  let now = 1_000;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "053_transaction_import_financial_plans.sql", "054_email_sender_authentication.sql", "055_generic_financial_email_imports.sql", "056_generic_financial_email_automation.sql", "058_generic_financial_email_income_automation.sql", "059_generic_financial_email_transfer_automation.sql", "062_financial_events.sql", "068_financial_candidate_dismissal.sql", "063_financial_activity.sql", "064_financial_corrections.sql", "069_financial_profiles.sql"]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await db.execute({
      sql: `INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at)
            VALUES (1, 'owner-1', 'hash', 1)`,
      args: [],
    });
  });

  afterEach(() => db.close());

  function store() {
    return createTransactionImportStore(db, () => now);
  }

  async function createRun(id = "run-1") {
    return store().createRun({
      id,
      userId: "owner-1",
      trigger: "arrival",
      optionsKey: "gmail-1:amazon:2026-01-01:2026-02-01",
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon"],
    });
  }

  function itemInput(overrides: Partial<InsertItemInput> = {}): InsertItemInput {
    return {
      id: "item-1",
      runId: "run-1",
      userId: "owner-1",
      gmailAccountId: "gmail-1",
      gmailMessageId: "message-1",
      emailUid: "gmail-gmail-1-message-1",
      candidateKey: "amazon-111-222",
      source: "amazon",
      parserVersion: "amazon-v1",
      externalId: "111-222",
      importedId: "amazon-111-222",
      date: "2026-01-15",
      amountCents: -2599,
      currency: "USD",
      payee: "Amazon",
      notes: "Order 111-222",
      actualAccountId: "actual-checking",
      actualCategoryId: "actual-shopping",
      automationMode: "automatic",
      automaticSafe: true,
      blockingWarnings: [],
      evidence: [{ code: "external_id", value: "111-222" }],
      status: "queued",
      ...overrides,
    };
  }

  it.each([
    ["create_transaction", 1, true], ["create_transaction", 2, false],
    ["create_transfer_schedule", 1, true], ["create_transfer_schedule", 2, false],
  ] as const)("checks the current profile revision at %s admission (saved revision: %s)", async (operation, revision, admitted) => {
    now = 1_000;
    await createRun();
    const subject = store();
    const financialPlan = savedPlan();
    financialPlan.profile = { status: "matched", revision: 1, budgetId: "fixture-budget", profileId: "receipt-profile", reason: "Owner configured the target." };
    financialPlan.operation = { intended: operation, kind: operation, reasons: [] };
    financialPlan.automation = { eligible: true, rollout: "enabled", operationClass: operation === "create_transaction" ? "one_time_expense" : "transfer_schedule",
      gates: ["profile", "semantic", "canonical_amount", "date", "targets", "authenticity", "stable_identity", "warnings", "reconciliation", "actual_preflight", "rollout"].map(gate => ({ gate, status: "pass", reasons: [] })) as FinancialEmailPlan["automation"]["gates"], reasons: [] };
    if (operation === "create_transfer_schedule") financialPlan.transferExecution = { budgetId: "fixture-budget" };
    const target = operation === "create_transaction" ? { kind: "expense", accountId: "actual-checking", payeeId: "amazon-payee" }
      : { kind: "card_payment", fromAccountId: "actual-checking", toAccountId: "card" };
    await db.execute({ sql: "INSERT INTO ea_settings (user_id, actual_budget_sync_id, financial_profiles_json, financial_profiles_revision) VALUES ('owner-1', 'fixture-budget', ?, ?)",
      args: [JSON.stringify([{ id: "receipt-profile", name: "Receipt profile", enabled: true, budgetId: "fixture-budget", senderAddresses: ["receipts@example.test"], target }]), revision] });
    expect(await subject.insertItem(itemInput({ source: operation === "create_transaction" ? "amazon" : "generic", status: "ready", financialPlan }))).toBe(true);
    const claim = await subject.claimNextItem("commit-worker");
    expect(claim?.status).toBe("importing");
    const result = operation === "create_transaction"
      ? await subject.admitOriginalImport(claim!, { budgetId: "fixture-budget", objects: [] })
      : await subject.markTransferAttempt("owner-1", "item-1", "commit-worker", "2026-09-01T18:00:00.000Z");
    expect(result).toBe(admitted);
    const item = await subject.getItem("owner-1", "item-1");
    if (operation === "create_transaction") expect(item?.originalAttemptedAt).toBe(admitted ? 1_000 : undefined);
    else expect(item?.financialPlan?.transferExecution?.attemptedAt).toBe(admitted ? "2026-09-01T18:00:00.000Z" : undefined);
  });

  it("executes only arrival items while retaining saved history for inspection", async () => {
    const subject = store();
    await createRun("saved-history");
    await db.execute("UPDATE ea_transaction_import_runs SET trigger = 'historical_scan', start_date = '2026-01-01', end_date = '2026-02-01' WHERE id = 'saved-history'");
    for (const status of ["queued", "ready", "failed", "needs_review"] as const) {
      await subject.insertItem(itemInput({ id: status, runId: "saved-history", candidateKey: status, importedId: status, status }));
    }
    expect(await subject.claimNextItem("old")).toBeNull();
    expect(await subject.getNextWakeAt()).toBeNull();
    expect(await subject.retryItem("owner-1", "failed")).toBe(false);
    expect(await subject.confirmItem("owner-1", "saved-history", "needs_review", { date: "2026-01-15", amountCents: -2599, payee: "Amazon", notes: "", actualAccountId: "card", actualCategoryId: null })).toBe(false);
    expect(await subject.getItem("owner-1", "ready")).toMatchObject({ status: "ready" });
    expect((await subject.listItemsForEmail("owner-1", itemInput().emailUid))[0]).toMatchObject({ runTrigger: "historical_scan" });
    expect((await subject.readDashboardActivity("owner-1")).reviewCount).toBe(0);
    await createRun();
    await subject.insertItem(itemInput());
    expect(await subject.claimNextItem("new")).toMatchObject({ id: "item-1" });
    expect(await subject.claimNextItem("old-again")).toBeNull();
  });

  it("suppresses corrected receipt aliases while allowing a different order from the same email", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput({ status: 'added' }));
    await db.execute("INSERT INTO ea_financial_correction_guards SELECT user_id,activity_id FROM ea_financial_activity_occurrences WHERE record_id='item-1'");
    await db.execute("UPDATE ea_transaction_import_runs SET status='completed' WHERE id='run-1'");
    await createRun('run-2');
    await subject.insertItem(itemInput({ id: 'repeat', runId: 'run-2', status: 'ready' }));
    const repeat = (await readImportRun(db, subject, 'owner-1', 'run-2'))!.items.find(item => item.id === 'repeat');
    expect(repeat).toMatchObject({ status: 'needs_review', automaticSafe: false });
    expect(await subject.claimNextItem('replay')).toBeNull();
    expect(await subject.confirmItem('owner-1', 'run-2', 'repeat', { date: '2026-01-15', amountCents: -2599, payee: 'Amazon', notes: '', actualAccountId: 'checking', actualCategoryId: null })).toBe(false);
    await subject.insertItem(itemInput({ id: 'different-order', runId: 'run-2', candidateKey: 'another-order', importedId: 'another-order', externalId: 'another-order', status: 'ready' }));
    expect(await subject.claimNextItem('new-order')).toMatchObject({ id: 'different-order' });
  });

  it("projects the last verified correction in Inbox and Dashboard without rewriting original import history", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput({ status: 'added' }));
    const occurrence = await db.execute("SELECT activity_id FROM ea_financial_activity_occurrences WHERE record_id='item-1' AND owner='import'");
    const activityId = String(occurrence.rows[0]!.activity_id);
    const effective = { correctionId: 'corrected', entry: { type: 'income', amountCents: 4500, date: '2026-01-16', payee: 'Refund' }, transactionId: 'actual-row' };
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('preview','owner-1',?,'{}',1)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at) VALUES ('corrected','owner-1',?,'budget','preview','key','completed',?,2)", args: [activityId, JSON.stringify(effective)] });
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('later-preview','owner-1',?,'{}',3)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,updated_at) VALUES ('later','owner-1',?,'budget','later-preview','later-key','recovering',3)", args: [activityId] });
    expect((await subject.listItemsForEmail('owner-1', itemInput().emailUid))[0]).toMatchObject({ effectiveResult: effective, correction: { id: 'later', state: 'recovering', revision: 1 }, amountCents: -2599, payee: 'Amazon' });
    expect((await subject.readDashboardActivity('owner-1')).recent[0]).toMatchObject({ amountCents: 4500, payee: 'Refund', description: 'Corrected record in Actual' });
    expect(await subject.getItem('owner-1','item-1')).toMatchObject({ amountCents: -2599, payee: 'Amazon' });
    expect(await subject.listItemsForEmail('another-owner', itemInput().emailUid)).toEqual([]);
  });

  it("keeps an accepted result without inventing original receipt values in Dashboard", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput({ status: 'added' }));
    const occurrence = await db.execute("SELECT activity_id FROM ea_financial_activity_occurrences WHERE record_id='item-1' AND owner='import'");
    const activityId = String(occurrence.rows[0]!.activity_id);
    const effective = { correctionId: 'kept', outcome: 'kept', resolution: 'kept_actual', evidence: { budgetId: 'budget', objects: [] }, snapshot: {} };
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('kept-preview','owner-1',?,'{}',1)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at) VALUES ('kept','owner-1',?,'budget','kept-preview','kept','completed',?,2)", args: [activityId, JSON.stringify(effective)] });
    expect((await subject.listItemsForEmail('owner-1', itemInput().emailUid))[0]?.effectiveResult).toEqual(effective);
    expect((await subject.readDashboardActivity('owner-1')).recent[0]).toMatchObject({ amountCents: null, description: 'Current Actual result kept' });
    expect(await subject.getItem('owner-1', 'item-1')).toMatchObject({ amountCents: -2599, payee: 'Amazon' });
  });

  it("projects bounded owner-wide review and automatic history without evidence or misleading counts", async () => {
    await createRun();
    const subject = store();
    await subject.createRun({ id: "run-2", userId: "owner-1", trigger: "arrival", optionsKey: "arrival-2", gmailAccountIds: ["gmail-1"], sources: ["amazon"] });
    const rows: Array<Partial<InsertItemInput>> = [
      { id: "review", status: "needs_review", runId: "run-1" },
      { id: "failed", status: "failed" },
      { id: "paused", status: "paused" },
      { id: "observe-ready", status: "ready", automationMode: "observe" },
      { id: "unsafe-ready", status: "ready", automaticSafe: false },
      { id: "automatic-ready", status: "ready" },
      { id: "dismissed", status: "dismissed" },
      { id: "added", status: "added" },
      { id: "updated", status: "updated" },
      { id: "present", status: "already_present" },
      { id: "latest-added", status: "added" },
      { id: "observe-added", status: "added", automationMode: "observe" },
      { id: "confirmed-added", status: "added" },
    ];
    for (const row of rows) {
      now += 100;
      await subject.insertItem(itemInput({
        runId: "run-2", ...row, candidateKey: row.id, gmailMessageId: row.id,
        evidence: [{ private: "must not appear" }], notes: "private notes",
      }));
    }
    await db.execute("UPDATE ea_transaction_import_items SET confirmed_at = 2300 WHERE id = 'confirmed-added'");

    const result = await subject.readDashboardActivity("owner-1");
    expect(result.reviewCount).toBe(5);
    expect(result.review.map((item) => item.id)).toEqual(["unsafe-ready", "observe-ready", "paused"]);
    expect(result.recent.map((item) => item.id)).toEqual(["latest-added", "present", "updated"]);
    expect(result.recent[0]).toEqual({
      id: "latest-added", runId: "run-2", emailUid: "gmail-gmail-1-message-1",
      payee: "Amazon", amountCents: -2599, currency: "USD", status: "added",
      description: "Recorded in Actual", updatedAt: 2100,
    });
    expect(await subject.readDashboardActivity("different-owner")).toEqual({
      status: "ready", reviewCount: 0, review: [], recent: [], error: null,
    });
  });

  it("persists cursors and item evidence without raw message bodies", async () => {
    await createRun();
    const subject = store();
    expect(await subject.insertItem(itemInput())).toBe(true);
    expect(await subject.insertItem(itemInput({ id: "duplicate" }))).toBe(false);
    await subject.updateRunProgress("owner-1", "run-1", {
      cursor: { gmailAccountIndex: 0, pageToken: "next-page" },
      discovered: 1,
      parsed: 1,
      queued: 1,
    });

    const detail = await readImportRun(db, subject, "owner-1", "run-1");
    expect(detail).toMatchObject({
      cursor: { gmailAccountIndex: 0, pageToken: "next-page" },
      counts: { discovered: 1, parsed: 1, queued: 1 },
      items: [{
        importedId: "amazon-111-222",
        evidence: [{ code: "external_id", value: "111-222" }],
        financialPlan: null,
        planShadow: null,
      }],
    });
    expect(JSON.stringify(detail)).not.toMatch(/html|message body/i);
    await expect(readImportRun(db, subject, "different-owner", "run-1")).resolves.toBeNull();
  });

  it("admits one observe-only generic item per stable financial-email identity", async () => {
    const subject = store();
    for (const id of ["generic-run-1", "generic-run-2"]) {
      await subject.createRun({
        id,
        userId: "owner-1",
        trigger: "arrival",
        optionsKey: id,
        gmailAccountIds: ["gmail-1"],
        sources: ["generic"],
      });
    }
    const generic = {
      source: "generic" as const,
      parserVersion: "financial-email-plan-v1",
      candidateKey: "financial-email:v1:stable",
      externalId: "financial-email:v1:stable",
      importedId: "financial-email:v1:stable",
      automationMode: "observe" as const,
      automaticSafe: false,
    };
    expect(await subject.insertItem(itemInput({ ...generic, id: "generic-1", runId: "generic-run-1" }))).toBe(true);
    expect(await subject.insertItem(itemInput({ ...generic, id: "generic-2", runId: "generic-run-2" }))).toBe(false);
  });

  it("persists the redacted financial plan and shadow comparison with the canonical item", async () => {
    await createRun();
    const subject = store();
    const financialPlan = savedPlan();
    const planShadow = {
      status: "planned" as const,
      operation: "review" as const,
      reconciliationStatus: "not_checked" as const,
      account: { liveId: "actual-checking", plannedId: "planned-account", agreement: "mismatch" as const },
      category: { liveId: "actual-shopping", plannedId: null, agreement: "unresolved" as const },
      automationEligible: false,
      automationReasons: ["actual_preflight_not_run" as const],
      failureCode: null,
    };
    await subject.insertItem(itemInput({ financialPlan, planShadow }));

    await expect(subject.getItem("owner-1", "item-1")).resolves.toMatchObject({
      importedId: "amazon-111-222",
      financialPlan,
      planShadow,
    });
  });

  it("lists bounded subject-bearing email items by owner", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput({
      emailSubject: "Your Amazon.com order #111-222",
    }));

    await expect(subject.listItemsForEmail("owner-1", "gmail-gmail-1-message-1")).resolves.toEqual([
      expect.objectContaining({
        id: "item-1",
        emailSubject: "Your Amazon.com order #111-222",
      }),
    ]);
    await expect(subject.listItemsForEmail("different-owner", "gmail-gmail-1-message-1")).resolves.toEqual([]);
  });

  it("retains historical item targets and mode without consulting legacy configuration", async () => {
    const subject = store();
    await createRun();
    await subject.insertItem(itemInput({ actualAccountId: "checking-old", actualCategoryId: "shopping-old", automationMode: "observe" }));
    await db.execute(`INSERT INTO ea_transaction_import_mappings
      (user_id, source, mode, actual_account_id, actual_category_id, created_at, updated_at)
      VALUES ('owner-1', 'amazon', 'automatic', 'checking-new', 'shopping-new', 1000, 2000)`);

    const detail = await readImportRun(db, subject, "owner-1", "run-1");
    expect(detail!.items[0]).toMatchObject({ actualAccountId: "checking-old", actualCategoryId: "shopping-old", automationMode: "observe" });
  });

  it("uses conditional updates so concurrent item claims have one winner", async () => {
    await createRun();
    const subjectA = store();
    const subjectB = store();

    await subjectA.insertItem(itemInput());
    const itemClaims = await Promise.all([
      subjectA.claimNextItem("item-worker-a"),
      subjectB.claimNextItem("item-worker-b"),
    ]);
    expect(itemClaims.filter(Boolean)).toHaveLength(1);
    expect(itemClaims.find(Boolean)).toMatchObject({ status: "reconciling", attempts: 1 });
  });

  it("requires the matching claim token to settle an item", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput());
    const claimed = await subject.claimNextItem("worker-token");
    expect(claimed).not.toBeNull();
    await expect(subject.settleItem("owner-1", "item-1", "wrong-token", {
      status: "ready",
      reconciliationStatus: "would_add",
    })).resolves.toBe(false);
    await expect(subject.settleItem("owner-1", "item-1", "worker-token", {
      status: "ready",
      reconciliationStatus: "would_add",
    })).resolves.toBe(true);
  });

  it("reports the earliest durable queue wake and ignores terminal work", async () => {
    const subject = store();
    await expect(subject.getNextWakeAt()).resolves.toBeNull();

    await createRun();
    await subject.insertItem(itemInput());
    await db.execute("UPDATE ea_transaction_import_runs SET status = 'retry', next_attempt_at = 6000 WHERE id = 'run-1'");
    await db.execute("UPDATE ea_transaction_import_items SET status = 'ready', next_attempt_at = 5000 WHERE id = 'item-1'");
    await expect(subject.getNextWakeAt()).resolves.toBe(5_000);

    await db.execute("UPDATE ea_transaction_import_runs SET status = 'completed' WHERE id = 'run-1'");
    await db.execute("UPDATE ea_transaction_import_items SET status = 'added' WHERE id = 'item-1'");
    await expect(subject.getNextWakeAt()).resolves.toBeNull();
  });

  it("recovers stale claims below the ceiling and terminally fails exhausted work", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput());
    await subject.claimNextItem("item-worker");
    await db.execute(`UPDATE ea_transaction_import_items SET attempts = 2, claimed_at = 100 WHERE id = 'item-1'`);

    now = 5_000;
    await expect(subject.recoverStaleClaims(1_000, 3)).resolves.toEqual({
      itemsRecovered: 1,
      itemsFailed: 0,
    });
    let detail = await readImportRun(db, subject, "owner-1", "run-1");
    expect(detail!.items[0]).toMatchObject({ status: "queued", lastError: expect.stringContaining("interrupted") });

    await subject.claimNextItem("item-worker-2");
    await db.execute(`UPDATE ea_transaction_import_items SET attempts = 3, claimed_at = 100 WHERE id = 'item-1'`);
    await expect(subject.recoverStaleClaims(1_000, 3)).resolves.toEqual({
      itemsRecovered: 0,
      itemsFailed: 1,
    });
    detail = await readImportRun(db, subject, "owner-1", "run-1");
    expect(detail!.items[0]).toMatchObject({ status: "failed", reconciliationStatus: "failed" });
  });

  it("recovers an interrupted pre-call import claim back to ready", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput());
    const preview = await subject.claimNextItem("preview-worker");
    await subject.settleItem("owner-1", "item-1", preview!.claimToken, {
      status: "ready",
      reconciliationStatus: "would_add",
    });
    const commit = await subject.claimNextItem("commit-worker");
    expect(commit).toMatchObject({ status: "importing" });
    await db.execute(`UPDATE ea_transaction_import_items SET claimed_at = 100 WHERE id = 'item-1'`);

    now = 5_000;
    await subject.recoverStaleClaims(1_000, 3);
    expect((await readImportRun(db, subject, "owner-1", "run-1"))!.items[0]).toMatchObject({
      status: "ready",
      reconciliationStatus: "would_add",
      lastError: expect.stringContaining("interrupted"),
    });
  });
});
