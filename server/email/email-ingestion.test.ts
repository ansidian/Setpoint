import type { Client, InStatement, TransactionMode } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailIndexTestDb, seedEmailAccount } from "./test-utils/email-index-db.ts";

const boundary = vi.hoisted(() => ({ database: null as unknown as Client }));
// test-architecture: allow-boundary-mock -- The scheduler and its real fetch/index/queue collaborators share one migrated ephemeral database at the database singleton boundary.
vi.mock("../db/connection.ts", () => ({ default: {
  execute: (statement: string | InStatement) => boundary.database.execute(statement),
  batch: (statements: InStatement[], mode?: TransactionMode) => boundary.database.batch(statements, mode),
} }));
// test-architecture: allow-boundary-mock -- Inbox acquisition is the external Gmail provider boundary; indexing and queue admission remain real.
vi.mock("./gmail.ts", () => ({ fetchEmails: vi.fn() }));
const { fetchEmails } = await import("./gmail.ts");
const { createSchedulerRuntime } = await import("../scheduler.ts");
const { getEmailSyncHealth } = await import("./email-sync-health.ts");
const fetchMock = vi.mocked(fetchEmails);
let runtime: ReturnType<typeof createSchedulerRuntime>;
let sweep: () => unknown;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  boundary.database = await createEmailIndexTestDb({ extraMigrations: ["028_provider_needs_reauth.sql", "078_email_sync_health.sql"] });
  await seedEmailAccount(boundary.database);
  runtime = createSchedulerRuntime({ cronSchedule: ((_expression: string, callback: () => unknown) => {
    if (_expression === "*/10 * * * *") sweep = callback as () => unknown;
    return { stop: () => {} };
  }) as never });
  runtime.startBackgroundIndexer();
});
afterEach(async () => {
  await runtime.stopScheduler();
  boundary.database.close();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});
async function health() { return getEmailSyncHealth("user-1", { dbClient: boundary.database }); }
const email = {
  uid: "gmail-gmail-work-one", account_id: "gmail-work", account_label: "Work", account_email: "work@example.com",
  account_color: "blue", account_icon: "Mail", from: "sender@example.com", subject: "Hello", body_preview: "Message", body_text: "Message", date: "2026-09-14T11:59:00Z", read: false, message_id: "one", thread_id: "one",
};

describe("scheduled inbox ingestion health", () => {
  it("records an empty successful provider check and isolates a failed account", async () => {
    await seedEmailAccount(boundary.database, { id: "gmail-personal", email: "personal@example.com" });
    fetchMock.mockImplementation(async (account) => {
      if (account.id === "gmail-personal") throw new Error("provider outage");
      return [];
    });
    await sweep();
    expect(await health()).toEqual([
      expect.objectContaining({ accountId: "gmail-work", state: "current", lastSuccessAt: "2026-09-14T12:00:00.000Z" }),
      expect.objectContaining({ accountId: "gmail-personal", state: "unavailable", lastSuccessAt: null }),
    ]);
  });

  it("advances success only after messages are indexed and durably admitted to triage", async () => {
    fetchMock.mockResolvedValue([email]);
    await sweep();
    expect((await health())[0]).toMatchObject({ state: "current", lastSuccessAt: "2026-09-14T12:00:00.000Z" });
    expect((await boundary.database.execute("SELECT uid FROM ea_email_index")).rows).toEqual([{ uid: email.uid }]);
    expect((await boundary.database.execute("SELECT email_id, status FROM ea_triage_jobs WHERE job_type = 'email_triage'")).rows)
      .toEqual([{ email_id: email.uid, status: "queued" }]);
  });

  it.each(["ea_email_index", "ea_triage_jobs"])("does not report success when the %s persistence stage fails", async (table) => {
    fetchMock.mockResolvedValueOnce([]);
    await sweep();
    vi.setSystemTime(new Date("2026-09-14T12:10:00Z"));
    await boundary.database.execute(`CREATE TRIGGER reject_ingestion BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'storage failure'); END`);
    fetchMock.mockResolvedValueOnce([email]);
    await sweep();
    expect((await health())[0]).toMatchObject({ state: "degraded", lastSuccessAt: "2026-09-14T12:00:00.000Z", expiresAt: "2026-09-14T12:20:00.000Z" });
  });
});
