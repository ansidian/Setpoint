import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActualImportAccountGroup, ActualImportBatchResult } from "../../shared/types/transaction-imports.ts";
import { emailFixture, paypalPaidText } from "./parsers/fixtures.ts";
import { createTransactionImportService } from "./transaction-import-service.ts";
import { createTransactionImportStore } from "./transaction-import-store.ts";
import { createTransactionImportWorker } from "./transaction-import-worker.ts";

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
    for (const file of ["001_ea_tables.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql"]) {
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

  async function mapping(store: ReturnType<typeof setup>["store"], source: "amazon" | "paypal", mode: "off" | "observe" | "automatic", accountId = "actual-1") {
    await store.upsertMapping("owner-1", { source, mode, actualAccountId: accountId, actualCategoryId: null });
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

  it("persists each historical page cursor and resumes without restarting", async () => {
    const { store, service } = setup();
    await mapping(store, "amazon", "off");
    const started = await service.startHistoricalScan("owner-1", {
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon"],
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });
    const searchPage = vi.fn()
      .mockResolvedValueOnce({ emails: [emailFixture()], nextPageToken: "page-2", resultSizeEstimate: 2, failures: [] })
      .mockResolvedValueOnce({ emails: [emailFixture({ gmailMessageId: "msg-2", uid: "gmail-personal-msg-2", subject: "Your Amazon.com order #444-5555555-6666666", text: "Order 444-5555555-6666666 Order Total: $8.72" })], nextPageToken: null, resultSizeEstimate: 2, failures: [] });
    const worker = createTransactionImportWorker({ store, dbClient: db, searchPage, createId });

    await expect(worker.processNextHistoricalPage()).resolves.toBe(true);
    expect(await store.getRun("owner-1", started.runId)).toMatchObject({
      status: "queued",
      cursor: { accountIndex: 0, sourceIndex: 0, pageToken: "page-2" },
    });
    await expect(worker.processNextHistoricalPage()).resolves.toBe(true);
    const detail = await store.getRunDetail("owner-1", started.runId);
    expect(detail).toMatchObject({ status: "completed", cursor: { complete: true } });
    expect(detail!.items).toHaveLength(2);
    expect(detail!.items.every((item) => item.automationMode === "observe")).toBe(true);
    // test-architecture: allow-boundary-interaction -- Gmail search is the outbound provider boundary; durable resume must send the exact stored page token on the second request.
    expect(searchPage).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ pageToken: "page-2" }));
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

  it("off ignores arrivals while observe dry-runs and never commits", async () => {
    const { store, service } = setup();
    await mapping(store, "amazon", "off");
    await expect(service.ingestArrivals("owner-1", [emailFixture()])).resolves.toEqual({ queued: 0, review: 0, runId: null });

    await mapping(store, "amazon", "observe");
    const arrival = await service.ingestArrivals("owner-1", [emailFixture()]);
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

  it("automatic dry-runs before one grouped commit and one invalidation fan-out", async () => {
    const { store, service } = setup();
    await mapping(store, "amazon", "automatic", "actual-checking");
    await mapping(store, "paypal", "automatic", "actual-card");
    const arrival = await service.ingestArrivals("owner-1", [
      emailFixture(),
      emailFixture({
        uid: "gmail-personal-paypal-1",
        gmailMessageId: "paypal-1",
        from: "service@paypal.com",
        subject: "You paid $5.00 USD to Valve Corp.",
        text: paypalPaidText,
      }),
    ]);
    const importGroups = vi.fn(async (_userId, groups, dryRun) => actualResult(groups, dryRun));
    const invalidateAfterCommit = vi.fn().mockResolvedValue(undefined);
    const worker = createTransactionImportWorker({ store, dbClient: db, importGroups, invalidateAfterCommit, createId });

    await worker.processNextItemBatch();
    let detail = await store.getRunDetail("owner-1", arrival.runId!);
    expect(detail!.items.map((item) => item.status)).toEqual(["ready", "ready"]);
    await worker.processNextItemBatch();
    detail = await store.getRunDetail("owner-1", arrival.runId!);

    // test-architecture: allow-boundary-interaction -- Actual import is the outbound financial boundary; the first request must preview both mapped accounts together.
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
    const { store, service } = setup();
    await mapping(store, "amazon", "automatic");
    const arrival = await service.ingestArrivals("owner-1", [emailFixture()]);
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
    const { store, service } = setup();
    await mapping(store, "amazon", "automatic");
    const arrival = await service.ingestArrivals("owner-1", [emailFixture()]);
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
    const { store, service } = setup();
    await mapping(store, "amazon", "automatic");
    const arrival = await service.ingestArrivals("owner-1", [emailFixture()]);
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
    const { store, service } = setup();
    await mapping(store, "paypal", "automatic");
    const arrival = await service.ingestArrivals("owner-1", [emailFixture({
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
    const { store, service } = setup();
    await mapping(store, "amazon", "automatic");
    const arrival = await service.ingestArrivals("owner-1", [emailFixture()]);
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
    await mapping(store, "amazon", "observe");
    const arrival = await service.ingestArrivals("owner-1", [emailFixture({
      gmailMessageId: "raw-gmail-message-id",
      uid: "gmail-personal-raw-gmail-message-id",
      subject: "Order confirmation",
      text: "Order Total: $12.00",
    })]);
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
