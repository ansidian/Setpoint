import { seedSavedImportItem, seedSavedImportRun, type SavedImportItemInput } from './transaction-import.test-utils.ts';
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransactionImportStore } from "./transaction-import-store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");


describe("transaction import store", () => {
  let db: Client;
  let now = 1_000;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "053_transaction_import_financial_plans.sql", "054_email_sender_authentication.sql", "055_generic_financial_email_imports.sql", "056_generic_financial_email_automation.sql", "058_generic_financial_email_income_automation.sql", "059_generic_financial_email_transfer_automation.sql", "062_financial_events.sql", "071_financial_event_readiness.sql", "068_financial_candidate_dismissal.sql", "063_financial_activity.sql", "064_financial_corrections.sql", "069_financial_profiles.sql", "080_financial_connections.sql", "081_provider_financial_assessments.sql", "083_financial_owner_requests.sql", "084_retire_legacy_financial_documents.sql"]) {
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
    return createTransactionImportStore(db);
  }

  async function createRun(id = "run-1", trigger: "arrival" | "historical_scan" = "arrival") {
    await seedSavedImportRun(db, { id, userId: "owner-1", trigger });
  }

  async function insertItem(input: SavedImportItemInput) {
    await seedSavedImportItem(db, input, now);
  }

  function itemInput(overrides: Partial<SavedImportItemInput> = {}): SavedImportItemInput {
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

  it("projects the last verified correction in Inbox and Dashboard without rewriting original import history", async () => {
    await createRun();
    const subject = store();
    await insertItem(itemInput({ status: 'added' }));
    const occurrence = await db.execute("SELECT activity_id FROM ea_financial_activity_occurrences WHERE record_id='item-1' AND owner='import'");
    const activityId = String(occurrence.rows[0]!.activity_id);
    const effective = { correctionId: 'corrected', entry: { type: 'income', amountCents: 4500, date: '2026-01-16', payee: 'Refund' }, transactionId: 'actual-row' };
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('preview','owner-1',?,'{}',1)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at) VALUES ('corrected','owner-1',?,'budget','preview','key','completed',?,2)", args: [activityId, JSON.stringify(effective)] });
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('later-preview','owner-1',?,'{}',3)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,updated_at) VALUES ('later','owner-1',?,'budget','later-preview','later-key','recovering',3)", args: [activityId] });
    expect((await subject.listItemsForEmail('owner-1', itemInput().emailUid))[0]).toMatchObject({ effectiveResult: effective, correction: { id: 'later', state: 'recovering', revision: 1 }, amountCents: -2599, payee: 'Amazon' });
    expect((await subject.readDashboardActivity('owner-1')).recent[0]).toMatchObject({ amountCents: 4500, payee: 'Refund', description: 'Corrected record in Actual' });
    expect(await subject.listItemsForEmail('another-owner', itemInput().emailUid)).toEqual([]);
  });


  it("keeps an accepted result without inventing original receipt values in Dashboard", async () => {
    await createRun();
    const subject = store();
    await insertItem(itemInput({ status: 'added' }));
    const occurrence = await db.execute("SELECT activity_id FROM ea_financial_activity_occurrences WHERE record_id='item-1' AND owner='import'");
    const activityId = String(occurrence.rows[0]!.activity_id);
    const effective = { correctionId: 'kept', outcome: 'kept', resolution: 'kept_actual', evidence: { budgetId: 'budget', objects: [] }, snapshot: {} };
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('kept-preview','owner-1',?,'{}',1)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at) VALUES ('kept','owner-1',?,'budget','kept-preview','kept','completed',?,2)", args: [activityId, JSON.stringify(effective)] });
    expect((await subject.listItemsForEmail('owner-1', itemInput().emailUid))[0]?.effectiveResult).toEqual(effective);
    expect((await subject.readDashboardActivity('owner-1')).recent[0]).toMatchObject({ amountCents: null, description: 'Current Actual result kept' });
  });


  it("projects bounded owner-wide automatic history without evidence and never asks for import review", async () => {
    await createRun();
    const subject = store();
    await createRun("run-2");
    const rows: Array<Partial<SavedImportItemInput>> = [
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
      await insertItem(itemInput({
        runId: "run-2", ...row, candidateKey: row.id, gmailMessageId: row.id,
        evidence: [{ private: "must not appear" }], notes: "private notes",
      }));
    }
    await db.execute("UPDATE ea_transaction_import_items SET confirmed_at = 2300 WHERE id = 'confirmed-added'");

    const result = await subject.readDashboardActivity("owner-1");
    expect(result.reviewCount).toBe(0);
    expect(result.review).toEqual([]);
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


  it("lists bounded subject-bearing email items by owner", async () => {
    await createRun();
    const subject = store();
    await insertItem(itemInput({
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


  it("retains saved historical-scan items for inspection", async () => {
    const subject = store();
    await createRun("saved-history", "historical_scan");
    for (const status of ["queued", "failed", "needs_review"] as const) {
      await insertItem(itemInput({ id: status, runId: "saved-history", candidateKey: status, importedId: status, status }));
    }
    expect((await subject.listItemsForEmail("owner-1", itemInput().emailUid))[0]).toMatchObject({ runTrigger: "historical_scan" });
    expect((await subject.readDashboardActivity("owner-1")).reviewCount).toBe(0);
  });
});
