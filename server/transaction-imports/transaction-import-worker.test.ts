import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActualImportAccountGroup, ActualImportBatchResult } from "../../shared/types/transaction-imports.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import { emailFixture, paypalPaidText } from "./parsers/fixtures.ts";
import { createTransactionImportService, prepareTransactionImportItems } from "./transaction-import-service.ts";
import { createTransactionImportStore } from "./transaction-import-store.ts";
import { createTransactionImportWorker } from "./transaction-import-worker.ts";
import { financialEmailPreflightItem, stageFinancialEmailPreflight } from "./financial-email-preflight.ts";
import type { TransactionEmailInput } from "./transaction-import-types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

describe("transaction import worker", () => {
  let db: Client;
  let sequence = 0;
  const createId = () => `id-${++sequence}`;

  beforeEach(async () => {
    sequence = 0;
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "052_financial_email_plans.sql", "053_transaction_import_financial_plans.sql", "055_generic_financial_email_imports.sql", "056_generic_financial_email_automation.sql"]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await db.execute(`INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at)
                      VALUES (1, 'owner-1', 'hash', 1)`);
    await db.execute(`INSERT INTO ea_accounts (id, user_id, type, email, label)
                      VALUES ('gmail-1', 'owner-1', 'gmail', 'owner@example.test', 'Personal')`);
  });

  afterEach(() => db.close());

  function setup(now = () => 1_000) {
    const store = createTransactionImportStore(db, now);
    const service = createTransactionImportService({ store, createId });
    return { store, service };
  }

  async function seedLegacyItems(
    store: ReturnType<typeof setup>["store"],
    emails: TransactionEmailInput[] = [emailFixture()],
    automationMode: "observe" | "automatic" = "automatic",
    accounts: { amazon: string; paypal: string } = { amazon: "actual-1", paypal: "actual-1" },
  ) {
    const runId = createId();
    const prepared = prepareTransactionImportItems("owner-1", runId, emails, createId);
    await store.createRun({
      id: runId, userId: "owner-1", trigger: "arrival", optionsKey: `legacy:${runId}`,
      gmailAccountIds: ["gmail-1"], sources: [...new Set(prepared.items.map((item) => item.source))],
    });
    for (const item of prepared.items) {
      await store.insertItem({
        ...item,
        actualAccountId: accounts[item.source as "amazon" | "paypal"],
        actualCategoryId: null,
        automationMode,
        automaticSafe: Boolean(item.importedId && item.externalId && item.date && item.amountCents
          && item.currency === "USD" && !item.blockingWarnings.some((warning) => (
          typeof warning === "object" && warning !== null && (warning as { blocking?: boolean }).blocking
        ))),
        status: item.date && item.amountCents && item.payee ? "queued" : "needs_review",
      });
    }
    await store.updateRunProgress("owner-1", runId, { status: "completed", cursor: { complete: true } });
    return { runId };
  }

  function actualResult(groups: ActualImportAccountGroup[], dryRun: boolean): ActualImportBatchResult {
    return {
      dryRun,
      groups: groups.map((group) => ({
        accountId: group.accountId,
        items: group.transactions.map((transaction) => ({
          itemId: transaction.itemId,
          importedId: transaction.importedId,
          outcome: dryRun ? "would_add" : "added",
          error: null,
        })),
      })),
    };
  }

  function alreadyPresentResult(groups: ActualImportAccountGroup[], dryRun: boolean): ActualImportBatchResult {
    return {
      dryRun,
      groups: groups.map((group) => ({
        accountId: group.accountId,
        items: group.transactions.map((transaction) => ({
          itemId: transaction.itemId,
          importedId: transaction.importedId,
          outcome: "already_present",
          error: null,
        })),
      })),
    };
  }

  function exactGenericPlan(): FinancialEmailPlan {
    return {
      version: 1,
      identity: { version: 1, status: "resolved", key: "financial-email:v1:worker" },
      candidate: { payee: "Example Market", amount: 12.34, amount_kind: "transaction_amount", due_date: "2026-09-01", event_kind: "purchase", type: "expense", currency: "USD" },
      classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 1, reasons: [] },
      operation: { intended: "create_transaction", kind: "create_transaction", reasons: [] },
      targets: {
        account: { kind: "account", status: "resolved", id: "actual-checking", label: "Checking", provenance: [] },
        payee: { kind: "payee", status: "resolved", id: "payee-1", label: "Example Market", provenance: [] },
        category: { kind: "category", status: "resolved", id: "category-1", label: "Groceries", provenance: [] },
        fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
        toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
        schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
      },
      reconciliation: { status: "not_checked", disposition: "review" },
      reviewReasons: [{ code: "reconciliation_unavailable", message: "Preflight required.", blocking: true }],
      automation: {
        eligible: false,
        operationClass: "one_time_expense",
        rollout: "observe_only",
        gates: [
          ...["semantic", "canonical_amount", "date", "targets", "authenticity", "stable_identity", "warnings"].map((gate) => ({ gate, status: "pass", reasons: [] })),
          { gate: "reconciliation", status: "unknown", reasons: ["reconciliation_unavailable"] },
          { gate: "actual_preflight", status: "unknown", reasons: ["actual_preflight_not_run"] },
          { gate: "rollout", status: "fail", reasons: ["automation_class_observe_only"] },
        ] as FinancialEmailPlan["automation"]["gates"],
        reasons: ["reconciliation_unavailable", "actual_preflight_not_run", "automation_class_observe_only"],
      },
    };
  }

  function enabledGenericPlan(): FinancialEmailPlan {
    const plan = exactGenericPlan();
    plan.reconciliation = { status: "not_scheduled", disposition: "create", reason: "no_match" };
    plan.reviewReasons = [];
    plan.automation.rollout = "enabled";
    plan.automation.gates = plan.automation.gates.map((gate) => (
      gate.gate === "rollout" || gate.gate === "reconciliation"
        ? { ...gate, status: "pass", reasons: [] } : gate
    ));
    plan.automation.reasons = ["actual_preflight_not_run"];
    return plan;
  }

  async function stageGeneric(store: ReturnType<typeof setup>["store"], plan = enabledGenericPlan()) {
    const result = await stageFinancialEmailPreflight("owner-1", {
      accountId: "gmail-1", emailId: "generic-email", emailSubject: "Receipt",
    }, plan, store);
    expect(result.staged).toBe(true);
    return result.runId!;
  }


  it("automatically previews and commits an enabled generic expense exactly once", async () => {
    const { store } = setup();
    const runId = await stageGeneric(store);
    const ledger = new Map<string, number>();
    const worker = createTransactionImportWorker({
      store, dbClient: db, createId,
      importGroups: async (_userId, groups, dryRun) => {
        if (!dryRun) {
          for (const transaction of groups.flatMap((group) => group.transactions)) {
            ledger.set(transaction.importedId, transaction.amountCents);
          }
        }
        return actualResult(groups, dryRun);
      },
      invalidateAfterCommit: async () => undefined,
    });

    await worker.processNextItemBatch();
    expect(ledger.size).toBe(0);
    expect((await store.getRunDetail("owner-1", runId))!.items[0]).toMatchObject({
      status: "ready", automationMode: "automatic", automaticSafe: true, confirmedAt: null,
      financialPlan: { automation: { eligible: true, rollout: "enabled" } },
    });
    await worker.processNextItemBatch();
    expect([...ledger.entries()]).toEqual([["financial-email:v1:worker", -1234]]);
    expect((await store.getRunDetail("owner-1", runId))!.items[0]).toMatchObject({ status: "added" });
    expect(await stageFinancialEmailPreflight("owner-1", {
      accountId: "gmail-1", emailId: "generic-email",
    }, enabledGenericPlan(), store)).toEqual({ staged: false, runId });
    await expect(worker.processNextItemBatch()).resolves.toBe(false);
  });

  it.each([
    ["already_present", "already_present"],
    ["failed", "failed"],
    ["would_update", "needs_review"],
  ] as const)("does not automatically commit a generic %s preview", async (outcome, status) => {
    const { store } = setup();
    const runId = await stageGeneric(store);
    const committed: string[] = [];
    const worker = createTransactionImportWorker({
      store, dbClient: db, createId,
      importGroups: async (_userId, groups, dryRun) => {
        if (!dryRun) committed.push(...groups.flatMap((group) => group.transactions.map((transaction) => transaction.importedId)));
        const result = actualResult(groups, dryRun);
        return { ...result, groups: result.groups.map((group) => ({
          ...group, items: group.items.map((item) => ({ ...item, outcome })),
        })) };
      },
    });
    await worker.processNextItemBatch();
    await expect(worker.processNextItemBatch()).resolves.toBe(false);
    expect(committed).toEqual([]);
    expect((await store.getRunDetail("owner-1", runId))!.items[0]).toMatchObject({
      status, automaticSafe: false, financialPlan: { automation: { eligible: false } },
    });
  });

  it("re-previews an uncertain generic commit with its original identity", async () => {
    const { store } = setup();
    const runId = await stageGeneric(store);
    const ledger = new Map<string, number>();
    const worker = createTransactionImportWorker({
      store, dbClient: db, createId, now: () => 1_000,
      importGroups: async (_userId, groups, dryRun) => {
        const transaction = groups[0]!.transactions[0]!;
        if (ledger.has(transaction.importedId)) return alreadyPresentResult(groups, dryRun);
        if (dryRun) return actualResult(groups, true);
        ledger.set(transaction.importedId, transaction.amountCents);
        throw Object.assign(new Error("Sync acknowledgement lost"), { code: "ACTUAL_IMPORT_SYNC_UNCERTAIN" });
      },
    });
    await worker.processNextItemBatch();
    await worker.processNextItemBatch();
    expect((await store.getRunDetail("owner-1", runId))!.items[0]).toMatchObject({ status: "queued" });
    await worker.processNextItemBatch();
    expect((await store.getRunDetail("owner-1", runId))!.items[0]).toMatchObject({
      status: "already_present", importedId: "financial-email:v1:worker", automaticSafe: false,
      financialPlan: { operation: { kind: "no_write" }, automation: { eligible: false } },
    });
    expect([...ledger.entries()]).toEqual([["financial-email:v1:worker", -1234]]);
    await expect(worker.processNextItemBatch()).resolves.toBe(false);
  });


  it("resumes a coalesced paused historical scan when the owner starts it again", async () => {
    const { store, service } = setup();
    const options = {
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon"] as Array<"amazon">,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    };
    const first = await service.startHistoricalScan("owner-1", options);
    await db.execute({ sql: `UPDATE ea_transaction_import_runs SET status = 'paused', last_error = 'reauth' WHERE id = ?`, args: [first.runId] });

    await expect(service.startHistoricalScan("owner-1", options)).resolves.toEqual({ runId: first.runId, created: false });
    expect(await store.getRun("owner-1", first.runId)).toMatchObject({ status: "retry", lastError: null });
  });

  it("honors a historical observe snapshot by dry-running without committing", async () => {
    const { store } = setup();
    const arrival = await seedLegacyItems(store, [emailFixture()], "observe");
    const importGroups = vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun));
    const invalidateAfterCommit = vi.fn();
    const worker = createTransactionImportWorker({ store, dbClient: db, importGroups, invalidateAfterCommit, createId });

    await expect(worker.processNextItemBatch()).resolves.toBe(true);
    await expect(worker.processNextItemBatch()).resolves.toBe(false);
    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; observe mode may issue exactly one preview and must never duplicate it.
    expect(importGroups).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; observe mode must frame the only request as a dry run for the exact owner.
    expect(importGroups).toHaveBeenCalledWith("owner-1", expect.any(Array), true);
    // test-architecture: allow-boundary-interaction -- Cache invalidation is a downstream process boundary; an observe-only preview must not fan out changed-finance refresh work.
    expect(invalidateAfterCommit).not.toHaveBeenCalled();
    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({
      status: "needs_review",
      reconciliationStatus: "would_add",
    });
  });

  it("previews a generic financial email once and persists the observe-only outcome", async () => {
    const { store } = setup();
    const plan = exactGenericPlan();
    await db.batch([
      {
        sql: `INSERT INTO ea_email_index
                (uid, user_id, account_id, account_label, account_email, subject, email_date, read)
              VALUES ('message-generic', 'owner-1', 'gmail-1', 'Personal', 'owner@example.test', 'Receipt', '2026-09-01', 0)`,
        args: [],
      },
      {
        sql: `INSERT INTO ea_email_triage
                (user_id, account_id, email_id, financial_email_plan_json)
              VALUES ('owner-1', 'gmail-1', 'message-generic', ?)`,
        args: [JSON.stringify(plan)],
      },
    ]);
    await store.createRun({
      id: "generic-run",
      userId: "owner-1",
      trigger: "arrival",
      optionsKey: "financial-email:v1:worker",
      gmailAccountIds: ["gmail-1"],
      sources: ["generic"],
    });
    const item = financialEmailPreflightItem(
      "owner-1",
      "generic-run",
      "generic-item",
      { accountId: "gmail-1", emailId: "message-generic", emailSubject: "Receipt" },
      plan,
    );
    expect(item).not.toBeNull();
    await store.insertItem(item!);
    const importGroups = vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun));
    const worker = createTransactionImportWorker({ store, dbClient: db, importGroups, createId });

    await expect(worker.processNextItemBatch()).resolves.toBe(true);
    await expect(worker.processNextItemBatch()).resolves.toBe(false);
    // test-architecture: allow-boundary-interaction -- Actual preview is the external financial boundary; one invocation proves the generic item reached preflight exactly once.
    expect(importGroups).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- The dry-run flag is the external Actual contract that prevents this observe-only item from crossing the commit point.
    expect(importGroups).toHaveBeenCalledWith("owner-1", expect.any(Array), true);
    const stored = await store.getItem("owner-1", "generic-item");
    expect(stored).toMatchObject({
      source: "generic",
      status: "needs_review",
      reconciliationStatus: "would_add",
      automaticSafe: false,
      financialPlan: {
        reconciliation: { status: "not_scheduled", disposition: "create" },
        automation: { eligible: false, rollout: "observe_only", reasons: ["automation_class_observe_only"] },
      },
    });
    const triage = await db.execute("SELECT financial_email_plan_json FROM ea_email_triage WHERE email_id = 'message-generic'");
    expect(JSON.parse(String(triage.rows[0]!.financial_email_plan_json))).toMatchObject({
      reconciliation: { status: "not_scheduled", disposition: "create" },
      automation: { eligible: false, rollout: "observe_only" },
    });
  });

  it("automatic dry-runs before one grouped commit and one invalidation fan-out", async () => {
    const { store } = setup();
    const arrival = await seedLegacyItems(store, [
      emailFixture(),
      emailFixture({
        uid: "gmail-personal-paypal-1",
        gmailMessageId: "paypal-1",
        from: "service@paypal.com",
        subject: "You paid $5.00 USD to Valve Corp.",
        text: paypalPaidText,
      }),
    ], "automatic", { amazon: "actual-checking", paypal: "actual-card" });
    const importGroups = vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun));
    const invalidateAfterCommit = vi.fn().mockResolvedValue(undefined);
    const worker = createTransactionImportWorker({ store, dbClient: db, importGroups, invalidateAfterCommit, createId });

    await worker.processNextItemBatch();
    let detail = await store.getRunDetail("owner-1", arrival.runId!);
    expect(detail!.items.map((item) => item.status)).toEqual(["ready", "ready"]);
    await worker.processNextItemBatch();
    detail = await store.getRunDetail("owner-1", arrival.runId!);

    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; the first request must preview both historical account snapshots together.
    expect(importGroups).toHaveBeenNthCalledWith(1, "owner-1", expect.arrayContaining([
      expect.objectContaining({ accountId: "actual-checking" }),
      expect.objectContaining({ accountId: "actual-card" }),
    ]), true);
    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; only the second request may cross the commit point.
    expect(importGroups).toHaveBeenNthCalledWith(2, "owner-1", expect.any(Array), false);
    // test-architecture: allow-boundary-interaction -- Finance cache invalidation is a downstream process boundary; one changed commit batch must create exactly one refresh fan-out.
    expect(invalidateAfterCommit).toHaveBeenCalledTimes(1);
    expect(detail!.items.map((item) => item.status)).toEqual(["added", "added"]);
  });

  it("retries an uncertain post-call failure with the same imported ID", async () => {
    const { store } = setup();
    const arrival = await seedLegacyItems(store);
    const previewWorker = createTransactionImportWorker({
      store,
      dbClient: db,
      importGroups: vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun)),
      invalidateAfterCommit: vi.fn(),
      createId,
    });
    await previewWorker.processNextItemBatch();

    let uncertainImportedId: string | null = null;
    const uncertainWorker = createTransactionImportWorker({
      store,
      dbClient: db,
      importGroups: vi.fn(async (_userId, groups) => {
        uncertainImportedId = groups[0]!.transactions[0]!.importedId;
        throw new Error("connection lost after Actual accepted the batch");
      }),
      invalidateAfterCommit: vi.fn(),
      createId,
      now: () => 10_000,
    });
    await uncertainWorker.processNextItemBatch();
    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({ status: "ready" });

    const retryWorker = createTransactionImportWorker({
      store,
      dbClient: db,
      importGroups: vi.fn(async (_userId: string, groups: ActualImportAccountGroup[], dryRun: boolean) => alreadyPresentResult(groups, dryRun)),
      invalidateAfterCommit: vi.fn(),
      createId,
      now: () => 20_000,
    });
    await db.execute(`UPDATE ea_transaction_import_items SET next_attempt_at = 0 WHERE run_id = '${arrival.runId}'`);
    await retryWorker.processNextItemBatch();
    const item = (await store.getRunDetail("owner-1", arrival.runId!))!.items[0]!;
    expect(item).toMatchObject({ status: "already_present", importedId: uncertainImportedId });
  });

  it.each([
    "ACTUAL_IMPORT_SYNC_UNCERTAIN",
    "ACTUAL_WORKER_TIMEOUT",
  ])("reconciles after an uncertain Actual commit (%s)", async (errorCode) => {
    const { store } = setup();
    const arrival = await seedLegacyItems(store);
    const previewWorker = createTransactionImportWorker({
      store,
      dbClient: db,
      importGroups: vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun)),
      invalidateAfterCommit: vi.fn(),
      createId,
    });
    await previewWorker.processNextItemBatch();
    await db.execute({
      sql: "UPDATE ea_transaction_import_items SET attempts = 4 WHERE run_id = ?",
      args: [arrival.runId!],
    });

    const uncertainWorker = createTransactionImportWorker({
      store,
      dbClient: db,
      importGroups: vi.fn().mockRejectedValue(Object.assign(
        new Error("out-of-sync after import"),
        { code: errorCode },
      )),
      invalidateAfterCommit: vi.fn(),
      createId,
      now: () => 10_000,
    });
    await uncertainWorker.processNextItemBatch();

    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({
      status: "queued",
      lastError: expect.stringContaining(errorCode),
    });
    const stored = await db.execute({
      sql: "SELECT next_attempt_at FROM ea_transaction_import_items WHERE run_id = ?",
      args: [arrival.runId!],
    });
    expect(Number(stored.rows[0]!.next_attempt_at)).toBe(10_000);
  });

  it("reconciles safely when persistence fails after Actual success", async () => {
    const { store } = setup();
    const arrival = await seedLegacyItems(store);
    const importGroups = vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun));
    const previewWorker = createTransactionImportWorker({ store, dbClient: db, importGroups, invalidateAfterCommit: vi.fn(), createId });
    await previewWorker.processNextItemBatch();

    let failFinalization = true;
    const interruptedStore = {
      ...store,
      settleItem: async (...args: Parameters<typeof store.settleItem>) => {
        if (failFinalization && args[3].status === "added") {
          failFinalization = false;
          throw new Error("database unavailable after Actual success");
        }
        return store.settleItem(...args);
      },
    };
    const commitWorker = createTransactionImportWorker({
      store: interruptedStore,
      dbClient: db,
      importGroups,
      invalidateAfterCommit: vi.fn(),
      createId,
      now: () => 10_000,
    });
    await commitWorker.processNextItemBatch();
    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({ status: "ready" });

    await db.execute(`UPDATE ea_transaction_import_items SET next_attempt_at = 0 WHERE run_id = '${arrival.runId}'`);
    const retryWorker = createTransactionImportWorker({
      store,
      dbClient: db,
      importGroups: vi.fn(async (_userId: string, groups: ActualImportAccountGroup[], dryRun: boolean) => alreadyPresentResult(groups, dryRun)),
      invalidateAfterCommit: vi.fn(),
      createId,
      now: () => 20_000,
    });
    await retryWorker.processNextItemBatch();
    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({
      status: "already_present",
      importedId: "amazon-111-2222222-3333333",
    });
  });

  it("keeps unsafe automatic candidates in review after Actual preview", async () => {
    const { store } = setup();
    const arrival = await seedLegacyItems(store, [emailFixture({
      uid: "gmail-personal-paypal-cad",
      gmailMessageId: "paypal-cad",
      from: "service@paypal.com",
      subject: "You paid $5.00 CAD to Merchant",
      text: "Transaction ID: 1AB23456CD789012E",
    })]);
    const importGroups = vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun));
    const worker = createTransactionImportWorker({ store, dbClient: db, importGroups, invalidateAfterCommit: vi.fn(), createId });

    await worker.processNextItemBatch();
    const item = (await store.getRunDetail("owner-1", arrival.runId!))!.items[0]!;
    expect(item).toMatchObject({ automaticSafe: false, status: "needs_review" });
    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; an automatically unsafe candidate must issue neither preview nor commit.
    expect(importGroups).toHaveBeenCalledTimes(0);
  });

  it("pauses incompatibility errors without changing the canonical imported ID", async () => {
    const { store } = setup();
    const arrival = await seedLegacyItems(store);
    const importGroups = vi.fn().mockRejectedValue(Object.assign(new Error("unsupported import"), { code: "ACTUAL_IMPORT_INCOMPATIBLE" }));
    const worker = createTransactionImportWorker({ store, dbClient: db, importGroups, createId });

    await worker.processNextItemBatch();
    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({
      importedId: "amazon-111-2222222-3333333",
      status: "paused",
      lastError: expect.stringContaining("ACTUAL_IMPORT_INCOMPATIBLE"),
    });
  });

  it("dry-runs owner-confirmed corrections and uses the legacy raw Gmail ID fallback", async () => {
    const { store, service } = setup();
    const arrival = await seedLegacyItems(store, [emailFixture({
      gmailMessageId: "raw-gmail-message-id",
      uid: "gmail-personal-raw-gmail-message-id",
      subject: "Order confirmation",
      text: "Order Total: $12.00",
    })], "observe");
    const importGroups = vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun));
    const worker = createTransactionImportWorker({ store, dbClient: db, importGroups, invalidateAfterCommit: vi.fn(), createId });

    await worker.processNextItemBatch();
    let item = (await store.getRunDetail("owner-1", arrival.runId!))!.items[0]!;
    expect(item).toMatchObject({ status: "needs_review", importedId: null });

    await expect(service.commitItems("owner-1", arrival.runId!, [{
      itemId: item.id,
      payee: "Amazon manual review",
      actualAccountId: "actual-1",
    }])).resolves.toEqual({ accepted: 1 });
    await worker.processNextItemBatch();
    item = (await store.getRunDetail("owner-1", arrival.runId!))!.items[0]!;
    expect(item).toMatchObject({ status: "ready", importedId: "raw-gmail-message-id", payee: "Amazon manual review" });
    await worker.processNextItemBatch();
    item = (await store.getRunDetail("owner-1", arrival.runId!))!.items[0]!;
    expect(item.status).toBe("added");
    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; an owner-confirmed correction must still pass through preview first.
    expect(importGroups).toHaveBeenNthCalledWith(1, "owner-1", expect.any(Array), true);
    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; the corrected legacy ID may cross the commit point only after the successful preview.
    expect(importGroups).toHaveBeenNthCalledWith(2, "owner-1", expect.any(Array), false);
  });
});
