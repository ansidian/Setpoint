import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransactionImportStore, type InsertItemInput } from "./transaction-import-store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

describe("transaction import store", () => {
  let db: Client;
  let now = 1_000;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "053_transaction_import_financial_plans.sql"]) {
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
      trigger: "historical_scan",
      optionsKey: "gmail-1:amazon:2026-01-01:2026-02-01",
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon"],
      startDate: "2026-01-01",
      endDate: "2026-02-01",
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

  it("upserts owner-scoped mappings while preserving creation time", async () => {
    const subject = store();
    await subject.upsertMapping("owner-1", {
      source: "amazon",
      mode: "observe",
      actualAccountId: "checking-1",
      actualCategoryId: "shopping-1",
    });
    now = 2_000;
    const updated = await subject.upsertMapping("owner-1", {
      source: "amazon",
      mode: "automatic",
      actualAccountId: "checking-2",
      actualCategoryId: null,
    });

    expect(updated).toMatchObject({
      source: "amazon",
      mode: "automatic",
      actualAccountId: "checking-2",
      actualCategoryId: null,
      createdAt: 1_000,
      updatedAt: 2_000,
    });
    await expect(subject.listMappings("different-owner")).resolves.toEqual([]);
  });

  it("coalesces an identical active historical run and admits a new one after completion", async () => {
    const first = await createRun("run-1");
    const coalesced = await createRun("run-2");
    expect(first.created).toBe(true);
    expect(coalesced).toMatchObject({ created: false, run: { id: "run-1" } });

    await db.execute("UPDATE ea_transaction_import_runs SET status = 'completed' WHERE id = 'run-1'");
    const next = await createRun("run-2");
    expect(next).toMatchObject({ created: true, run: { id: "run-2" } });
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

    const detail = await subject.getRunDetail("owner-1", "run-1");
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
    await expect(subject.getRunDetail("different-owner", "run-1")).resolves.toBeNull();
  });

  it("persists the redacted financial plan and shadow comparison with the canonical item", async () => {
    await createRun();
    const subject = store();
    const financialPlan = {
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

  it("lists recent runs and bounded subject-bearing email items by owner", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput({
      emailSubject: "Your Amazon.com order #111-222",
    }));

    await expect(subject.listRuns("owner-1", 5)).resolves.toEqual([
      expect.objectContaining({ id: "run-1" }),
    ]);
    await expect(subject.listItemsForEmail("owner-1", "gmail-gmail-1-message-1")).resolves.toEqual([
      expect.objectContaining({
        id: "item-1",
        emailSubject: "Your Amazon.com order #111-222",
      }),
    ]);
    await expect(subject.listItemsForEmail("different-owner", "gmail-gmail-1-message-1")).resolves.toEqual([]);
  });

  it("snapshots mappings on items so later mapping changes do not rewrite queued work", async () => {
    const subject = store();
    await subject.upsertMapping("owner-1", {
      source: "amazon",
      mode: "observe",
      actualAccountId: "checking-old",
      actualCategoryId: "shopping-old",
    });
    await createRun();
    await subject.insertItem(itemInput({ actualAccountId: "checking-old", actualCategoryId: "shopping-old" }));
    now = 2_000;
    await subject.upsertMapping("owner-1", {
      source: "amazon",
      mode: "automatic",
      actualAccountId: "checking-new",
      actualCategoryId: "shopping-new",
    });

    const detail = await subject.getRunDetail("owner-1", "run-1");
    expect(detail!.items[0]).toMatchObject({ actualAccountId: "checking-old", actualCategoryId: "shopping-old" });
  });

  it("uses conditional updates so concurrent run and item claims have one winner", async () => {
    await createRun();
    const subjectA = store();
    const subjectB = store();
    const runClaims = await Promise.all([
      subjectA.claimNextRun("run-worker-a"),
      subjectB.claimNextRun("run-worker-b"),
    ]);
    expect(runClaims.filter(Boolean)).toHaveLength(1);

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
    await subject.claimNextRun("run-worker");
    await subject.claimNextItem("item-worker");
    await db.execute(`UPDATE ea_transaction_import_runs SET attempts = 2, claimed_at = 100 WHERE id = 'run-1'`);
    await db.execute(`UPDATE ea_transaction_import_items SET attempts = 2, claimed_at = 100 WHERE id = 'item-1'`);

    now = 5_000;
    await expect(subject.recoverStaleClaims(1_000, 3)).resolves.toEqual({
      runsRecovered: 1,
      runsFailed: 0,
      itemsRecovered: 1,
      itemsFailed: 0,
    });
    let run = await subject.getRun("owner-1", "run-1");
    let detail = await subject.getRunDetail("owner-1", "run-1");
    expect(run).toMatchObject({ status: "retry", lastError: expect.stringContaining("interrupted") });
    expect(detail!.items[0]).toMatchObject({ status: "queued", lastError: expect.stringContaining("interrupted") });

    await subject.claimNextRun("run-worker-2");
    await subject.claimNextItem("item-worker-2");
    await db.execute(`UPDATE ea_transaction_import_runs SET attempts = 3, claimed_at = 100 WHERE id = 'run-1'`);
    await db.execute(`UPDATE ea_transaction_import_items SET attempts = 3, claimed_at = 100 WHERE id = 'item-1'`);
    await expect(subject.recoverStaleClaims(1_000, 3)).resolves.toEqual({
      runsRecovered: 0,
      runsFailed: 1,
      itemsRecovered: 0,
      itemsFailed: 1,
    });
    run = await subject.getRun("owner-1", "run-1");
    detail = await subject.getRunDetail("owner-1", "run-1");
    expect(run!.status).toBe("failed");
    expect(detail!.items[0]).toMatchObject({ status: "failed", reconciliationStatus: "failed" });
  });

  it("immediately reclaims an abandoned historical scan after restart without reclaiming Actual work", async () => {
    await createRun();
    const subject = store();
    await subject.insertItem(itemInput());
    await subject.claimNextRun("run-worker");
    await subject.claimNextItem("item-worker");

    now = 5_000;
    await expect(subject.recoverAbandonedHistoricalRuns()).resolves.toEqual({
      runsRecovered: 1,
    });
    expect(await subject.getRun("owner-1", "run-1")).toMatchObject({
      status: "retry",
      lastError: expect.stringContaining("server restart"),
    });
    expect((await subject.getRunDetail("owner-1", "run-1"))!.items[0]).toMatchObject({
      status: "reconciling",
    });
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
    expect((await subject.getRunDetail("owner-1", "run-1"))!.items[0]).toMatchObject({
      status: "ready",
      reconciliationStatus: "would_add",
      lastError: expect.stringContaining("interrupted"),
    });
  });
});
