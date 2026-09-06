import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { createFinancialEmailPlanner } from "../bills/financial-email-planner.ts";
import { createFinancialEventStore } from "../financial-events/financial-event-store.ts";
import { createTransactionImportStore } from "./transaction-import-store.ts";
import { createTransactionImportService } from "./transaction-import-service.ts";
import { createTransactionImportWorker } from "./transaction-import-worker.ts";
import { planTransactionImportItems } from "./transaction-import-planner-adapter.ts";
import { stageFinancialEmailPreflight } from "./financial-email-preflight.ts";
import { emailFixture } from "./parsers/fixtures.ts";
import type { TransactionEmailInput } from "./transaction-import-types.ts";
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
      gates: ["semantic", "canonical_amount", "date", "targets", "authenticity", "stable_identity", "warnings", "reconciliation", "rollout"]
        .map((gate) => ({ gate, status: "pass", reasons: [] })) as FinancialEmailPlan["automation"]["gates"],
    },
  };
}

describe("financial event source ownership", () => {
  let db: Client;
  let sequence: number;

  beforeEach(async () => {
    db = await createMigratedDb();
    sequence = 0;
    await db.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2026-07-01T00:00:00Z'");
    await db.execute("INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at) VALUES (1, 'owner-1', 'hash', 1)");
    await db.execute("INSERT INTO ea_accounts (id, user_id, type, email, label) VALUES ('gmail-1', 'owner-1', 'gmail', 'owner@example.test', 'Mail')");
  });
  afterEach(() => db.close());

  async function capture(email: TransactionEmailInput, date = "2026-07-21T17:30:00Z"): Promise<void> {
    await db.execute({
      sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email,
              from_address, subject, body_text, email_date, email_date_utc, indexed_at)
            VALUES (?, 'owner-1', 'gmail-1', 'Mail', 'owner@example.test', ?, ?, ?, ?, ?, '2026-07-21T17:31:00Z')`,
      args: [email.uid, email.from, email.subject, email.text || "", date, date],
    });
  }

  function setup() {
    const store = createTransactionImportStore(db);
    const createId = () => `test-${++sequence}`;
    const planner = createFinancialEmailPlanner({
      metadataReader: async () => ({
        accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
        syncHealth: { state: "current", lastSuccessAt: "2026-07-21T18:00:00Z" },
      }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
      transactionReader: async () => ({ transactions: [] }),
      now: () => new Date("2026-07-21T18:00:00Z"),
    });
    const planItems = (userId: string, items: Parameters<typeof planTransactionImportItems>[1]) => planTransactionImportItems(userId, items, planner);
    return { store, createId, planItems, service: createTransactionImportService({ store, createId, planItems }) };
  }

  it("leaves managed arrivals with the financial workflow instead of creating legacy parser runs", async () => {
    const email = emailFixture({ uid: "managed", gmailAccountId: "gmail-1" });
    await capture(email);
    const { store, service } = setup();
    expect(await service.ingestArrivals("owner-1", [email])).toEqual({ queued: 0, review: 0, runId: null });
    expect(await store.listRuns("owner-1")).toEqual([]);
    expect(await createFinancialEventStore(db).getDocumentForEmail("owner-1", email.uid)).toMatchObject({ status: "pending" });
  });

  it("excludes managed mail from historical parser discovery while retaining older mail", async () => {
    const managed = emailFixture({ uid: "managed", gmailAccountId: "gmail-1" });
    const legacy = emailFixture({ uid: "legacy", gmailMessageId: "legacy", gmailAccountId: "gmail-1" });
    await capture(managed);
    await capture(legacy, "2026-06-01T00:00:00Z");
    const { store, service, createId, planItems } = setup();
    const run = await service.startHistoricalScan("owner-1", {
      gmailAccountIds: ["gmail-1"], sources: ["amazon"], startDate: "2026-01-01", endDate: "2026-08-01",
    });
    const worker = createTransactionImportWorker({
      store, dbClient: db, createId, planItems,
      searchPage: async () => ({ emails: [managed, legacy], nextPageToken: null, resultSizeEstimate: 2, failures: [] }),
    });
    expect(await worker.processNextHistoricalPage()).toBe(true);
    const detail = await store.getRunDetail("owner-1", run.runId);
    expect(detail?.status).toBe("completed");
    expect(detail?.items.map((item) => item.emailUid)).toEqual(["legacy"]);
    expect(await createFinancialEventStore(db).getDocumentForEmail("owner-1", managed.uid)).toMatchObject({ status: "pending" });
  });

  it("blocks generic legacy staging for managed mail and keeps older manual staging available", async () => {
    const { store } = setup();
    await capture(emailFixture({ uid: "managed", gmailAccountId: "gmail-1" }));
    await capture(emailFixture({ uid: "legacy", gmailAccountId: "gmail-1" }), "2026-06-01T00:00:00Z");
    expect(await stageFinancialEmailPreflight("owner-1", { accountId: "gmail-1", emailId: "managed" }, genericPlan(), store))
      .toEqual({ staged: false, runId: null });
    const old = await stageFinancialEmailPreflight("owner-1", { accountId: "gmail-1", emailId: "legacy" }, genericPlan(), store);
    expect(old.staged).toBe(true);
    expect((await store.getRunDetail("owner-1", old.runId!))?.items).toMatchObject([{ emailUid: "legacy", status: "queued" }]);
  });
});
