import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActualImportAccountGroup, ActualImportBatchResult } from "../../shared/types/transaction-imports.ts";
import { createFinancialEmailPlanner } from "../bills/financial-email-planner.ts";
import { emailFixture } from "./parsers/fixtures.ts";
import { planTransactionImportItems } from "./transaction-import-planner-adapter.ts";
import { createTransactionImportService } from "./transaction-import-service.ts";
import { createTransactionImportStore } from "./transaction-import-store.ts";
import { createTransactionImportWorker } from "./transaction-import-worker.ts";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

describe("transaction import planner ownership", () => {
  let db: Client;
  let sequence = 0;
  const createId = () => `id-${++sequence}`;

  beforeEach(async () => {
    sequence = 0;
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "052_financial_email_plans.sql", "053_transaction_import_financial_plans.sql", "054_email_sender_authentication.sql", "055_generic_financial_email_imports.sql", "056_generic_financial_email_automation.sql", "058_generic_financial_email_income_automation.sql", "062_financial_events.sql"]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await db.execute(`INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at)
                      VALUES (1, 'owner-1', 'hash', 1)`);
    await db.execute(`INSERT INTO ea_accounts (id, user_id, type, email, label)
                      VALUES ('gmail-1', 'owner-1', 'gmail', 'owner@example.test', 'Personal')`);
  });

  afterEach(() => db.close());

  function setup() {
    const store = createTransactionImportStore(db, () => 1_000);
    return { store, service: createTransactionImportService({ store, createId }) };
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

  it("imports a new source receipt using planner-owned Actual targets despite retired off configuration", async () => {
    const { store } = setup();
    await db.execute(`INSERT INTO ea_transaction_import_mappings
      (user_id, source, mode, actual_account_id, actual_category_id, created_at, updated_at)
      VALUES ('owner-1', 'amazon', 'off', 'obsolete-account', 'obsolete-category', 1000, 1000)`);
    const planner = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [{ id: "current-card", name: "Everyday Card", type: "credit" }],
        payees: [{ id: "amazon", name: "Amazon" }],
        payeeMap: { amazon: "Amazon" },
        categories: [{ group_name: "Spending", categories: [{ id: "shopping", name: "Shopping" }] }],
        schedules: [], recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-07-21T18:00:00.000Z" },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({ transactions: [
        { id: "earlier-1", date: "2026-07-01", amount: 20, direction: "expense", payee: "Amazon", payeeId: "amazon", category: "Shopping", categoryId: "shopping", account: "Everyday Card", accountId: "current-card", notes: "" },
        { id: "earlier-2", date: "2026-06-01", amount: 18, direction: "expense", payee: "Amazon", payeeId: "amazon", category: "Shopping", categoryId: "shopping", account: "Everyday Card", accountId: "current-card", notes: "" },
      ] }),
      now: () => new Date("2026-07-21T18:00:00.000Z"),
    });
    const service = createTransactionImportService({
      store, createId,
      planItems: (userId, items) => planTransactionImportItems(userId, items, planner),
    });
    const arrival = await service.ingestArrivals("owner-1", [emailFixture({ gmailAccountId: "gmail-1" })]);
    const ledger: Array<{ accountId: string; categoryId: string | null; importedId: string; amountCents: number }> = [];
    const worker = createTransactionImportWorker({
      store, dbClient: db, createId,
      importGroups: async (_userId, groups, dryRun) => {
        if (!dryRun) for (const group of groups) for (const transaction of group.transactions) {
          ledger.push({
            accountId: group.accountId,
            categoryId: transaction.categoryId ?? null,
            importedId: transaction.importedId,
            amountCents: transaction.amountCents,
          });
        }
        return actualResult(groups, dryRun);
      },
      invalidateAfterCommit: async () => undefined,
    });

    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({
      status: "queued", actualAccountId: "current-card", actualCategoryId: "shopping",
      importedId: "amazon-111-2222222-3333333", amountCents: -2704,
      automationMode: "automatic", automaticSafe: false, confirmedAt: null,
      financialPlan: { candidate: { transaction_import: { executionOwner: "planner" } } },
    });
    await worker.processNextItemBatch();
    expect(ledger).toEqual([]);
    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({
      status: "ready", automaticSafe: true, confirmedAt: null,
    });
    await worker.processNextItemBatch();
    expect(ledger).toEqual([{
      accountId: "current-card", categoryId: "shopping", importedId: "amazon-111-2222222-3333333", amountCents: -2704,
    }]);
    expect((await store.getRunDetail("owner-1", arrival.runId!))!.items[0]).toMatchObject({
      status: "added", confirmedAt: null,
      financialPlan: { candidate: { transaction_import: { executionOwner: "planner" } } },
    });
    await expect(worker.processNextItemBatch()).resolves.toBe(false);
  });

  it("persists each historical page cursor and resumes without restarting", async () => {
    const { store, service } = setup();
    const started = await service.startHistoricalScan("owner-1", {
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon"],
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });
    const searchPage = vi.fn()
      .mockResolvedValueOnce({ emails: [emailFixture()], nextPageToken: "page-2", resultSizeEstimate: 2, failures: [] })
      .mockResolvedValueOnce({ emails: [emailFixture({ gmailMessageId: "msg-2", uid: "gmail-personal-msg-2", subject: "Your Amazon.com order #444-5555555-6666666", text: "Order 444-5555555-6666666 Order Total: $8.72" })], nextPageToken: null, resultSizeEstimate: 2, failures: [] });
    const worker = createTransactionImportWorker({
      store,
      dbClient: db,
      searchPage,
      createId,
      planItems: (userId, items) => planTransactionImportItems(userId, items, createFinancialEmailPlanner({
        metadataReader: async () => ({
          accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
          syncHealth: { state: "current", lastSuccessAt: "2026-01-15T00:00:00.000Z" },
        }),
        occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current", lastSuccessAt: "2026-01-15T00:00:00.000Z" } }),
        transactionReader: async () => ({ transactions: [] }),
        now: () => new Date("2026-01-15T00:00:00.000Z"),
      })),
    });

    await expect(worker.processNextHistoricalPage()).resolves.toBe(true);
    expect(await store.getRun("owner-1", started.runId)).toMatchObject({
      status: "queued",
      cursor: { accountIndex: 0, sourceIndex: 0, pageToken: "page-2" },
    });
    await expect(worker.processNextHistoricalPage()).resolves.toBe(true);
    const detail = await store.getRunDetail("owner-1", started.runId);
    expect(detail).toMatchObject({ status: "completed", cursor: { complete: true } });
    expect(detail!.items).toHaveLength(2);
    expect(detail!.items.every((item) => item.status === "needs_review" && !item.actualAccountId)).toBe(true);
    // test-architecture: allow-boundary-interaction -- Gmail search is the outbound provider boundary; durable resume must send the exact stored page token on the second request.
    expect(searchPage).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ pageToken: "page-2" }));
  });

});
