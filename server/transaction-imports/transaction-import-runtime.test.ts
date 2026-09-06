import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransactionImportRuntime } from "./transaction-import-runtime.ts";
import { createFinancialEventStore } from "../financial-events/financial-event-store.ts";
import { createFinancialEventIntake } from "../financial-events/financial-event-intake.ts";
import { createEmailIndexTestDb, seedEmailAccount, seedIndexedEmail } from "../email/test-utils/email-index-db.ts";

const workerMock = vi.hoisted(() => ({
  recoverAbandonedHistoricalRuns: vi.fn().mockResolvedValue({}),
  recoverStaleClaims: vi.fn().mockResolvedValue({}),
  processNextHistoricalPage: vi.fn(),
  processNextItemBatch: vi.fn().mockResolvedValue(false),
  getNextWakeAt: vi.fn().mockResolvedValue(null),
}));

async function flushDrain(): Promise<void> {
  for (let index = 0; index < 100; index++) await Promise.resolve();
}

describe("transaction import runtime", () => {
  beforeEach(() => {
    workerMock.recoverAbandonedHistoricalRuns.mockReset().mockResolvedValue({});
    workerMock.recoverStaleClaims.mockReset().mockResolvedValue({});
    workerMock.processNextHistoricalPage.mockReset().mockResolvedValue(false);
    workerMock.processNextItemBatch.mockReset().mockResolvedValue(false);
    workerMock.getNextWakeAt.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("stops admission and waits for in-flight work before shutdown completes", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pageStarted = new Promise<void>((resolve) => {
      workerMock.processNextHistoricalPage.mockImplementationOnce(() => new Promise<boolean>((done) => {
        release = () => done(false);
        resolve();
      }));
    });
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    await vi.advanceTimersToNextTimerAsync();
    await pageStarted;
    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);

    runtime.requestDrain();
    await vi.advanceTimersByTimeAsync(0);
    // test-architecture: allow-boundary-interaction -- Worker admission is a background-process boundary; after stop, a new drain request must not admit a second durable worker pass.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(1);
  });

  it("reclaims abandoned Gmail scans at startup without polling an idle queue every 30 seconds", async () => {
    vi.useFakeTimers();
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    // test-architecture: allow-boundary-interaction -- Startup recovery is a durable worker boundary; abandoned historical scans must be reclaimed exactly once before interval admission.
    expect(workerMock.recoverAbandonedHistoricalRuns).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Stale-claim recovery is a durable worker boundary; startup must perform the initial recovery before scheduling later sweeps.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    await flushDrain();

    await vi.advanceTimersByTimeAsync(299_999);
    // test-architecture: allow-boundary-interaction -- Idle runtime admission is the behavior under test; no legacy 30-second process wake may reach the durable worker boundary.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Stale recovery is now a sparse safety boundary, so an idle runtime must not re-run it before five minutes.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersToNextTimerAsync();
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- The five-minute safety boundary must still recover stale claims and admit one durable queue check.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(2);
    // test-architecture: allow-boundary-interaction -- The safety pass remains a real queue backstop even when no in-process admission signal arrives.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(2);

    await runtime.stop();
  });

  it("wakes at the earliest durable retry timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    workerMock.getNextWakeAt
      .mockResolvedValueOnce(61_000)
      .mockResolvedValueOnce(null);
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushDrain();
    await vi.advanceTimersByTimeAsync(59_999);
    // test-architecture: allow-boundary-interaction -- A future durable retry is a timer/process boundary; it must not be claimed before its stored timestamp.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersToNextTimerAsync();
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- Reaching the stored retry timestamp must admit exactly one follow-up drain without waiting for the safety backstop.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(2);

    await runtime.stop();
  });

  it("keeps bounded 30-second pacing only after a drain exhausts its work cap", async () => {
    vi.useFakeTimers();
    workerMock.processNextHistoricalPage
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- The bounded worker contract permits five historical pages in one drain and must stop at that cap.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(29_999);
    // test-architecture: allow-boundary-interaction -- The saturated-drain boundary must remain quiet until its full pacing delay has elapsed.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersToNextTimerAsync();
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- Saturated work, unlike idle state, must retain the existing 30-second follow-up pacing.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(6);

    await runtime.stop();
  });

  it("does not lose an immediate wake requested during an active drain", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pageStarted = new Promise<void>((resolve) => {
      workerMock.processNextHistoricalPage.mockImplementationOnce(() => new Promise<boolean>((done) => {
        release = () => done(false);
        resolve();
      }));
    });
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await pageStarted;
    runtime.requestDrain();
    release();
    await vi.advanceTimersByTimeAsync(0);

    // test-architecture: allow-boundary-interaction -- A queue-admission signal racing an active background drain must produce a second durable pass instead of being dropped.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(2);
    await runtime.stop();
  });

  it("drains durable financial documents and wakes their events before a later import retry", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-09-07T00:00:00Z");
    vi.setSystemTime(startedAt);
    const database = await createEmailIndexTestDb({ extraMigrations: [] });
    await database.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2000-01-01T00:00:00Z'");
    const store = createFinancialEventStore(database);
    await seedIndexedEmail(database, { uid: "arrival", email_date: "2026-09-06T12:01:00Z" });
    workerMock.getNextWakeAt.mockResolvedValue(startedAt + 120_000);
    const runtime = createTransactionImportRuntime(workerMock, {
      recoverStaleClaims: store.recoverStaleClaims,
      getNextWakeAt: store.getNextWakeAt,
      async processNextDocument() {
        const document = await store.claimDocument("document");
        if (!document) return false;
        await store.associateDocument(document, {
          candidate: { type: "expense", amount: 12, payee: "Example Market" },
          contentHash: "receipt", eventId: "event", nextAttemptAt: Date.now() + 60_000,
        });
        return true;
      },
      async processNextEvent() {
        const event = await store.claimEvent("event");
        if (!event) return false;
        await store.saveEvent(event, { plan: null, status: "settled", outcome: { status: "processed" } });
        return true;
      },
    });
    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(0);
      await flushDrain();
      expect(await store.getEventForEmail("user-1", "arrival")).toMatchObject({ status: "pending", nextAttemptAt: startedAt + 60_000 });
      await vi.advanceTimersByTimeAsync(59_999);
      expect((await store.getEventForEmail("user-1", "arrival"))?.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersToNextTimerAsync();
      await flushDrain();
      expect(await store.getEventForEmail("user-1", "arrival")).toMatchObject({ status: "settled", outcome: { status: "processed" } });
    } finally {
      await runtime.stop();
      database.close();
    }
  });

  it("waits for admitted financial work to persist before stopping and leaves later arrivals pending", async () => {
    vi.useFakeTimers();
    const database = await createEmailIndexTestDb({ extraMigrations: [] });
    await database.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2000-01-01T00:00:00Z'");
    const store = createFinancialEventStore(database);
    await seedIndexedEmail(database, { uid: "first" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let admitted!: () => void;
    const admission = new Promise<void>((resolve) => { admitted = resolve; });
    const runtime = createTransactionImportRuntime(workerMock, {
      recoverStaleClaims: store.recoverStaleClaims,
      getNextWakeAt: store.getNextWakeAt,
      async processNextDocument() {
        const document = await store.claimDocument("document");
        if (!document) return false;
        admitted();
        await gate;
        await store.settleDocument(document, { candidate: null, contentHash: "not-financial", status: "ignored" });
        return true;
      },
      async processNextEvent() { return false; },
    });
    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(0);
      await admission;
      let stopped = false;
      const stopping = runtime.stop().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);
      release();
      await stopping;
      expect(stopped).toBe(true);
      await seedIndexedEmail(database, { uid: "later" });
      runtime.requestDrain();
      await vi.advanceTimersByTimeAsync(0);
      const documents = await database.execute("SELECT email_uid, status FROM ea_financial_documents ORDER BY id");
      expect(documents.rows).toEqual([{ email_uid: "first", status: "ignored" }, { email_uid: "later", status: "pending" }]);
    } finally {
      release();
      await runtime.stop();
      database.close();
    }
  });

  it("limits durable received-mail acquisition to five pages before pacing the remaining capture", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-09-02T00:00:00Z");
    vi.setSystemTime(startedAt);
    const database = await createEmailIndexTestDb({ extraMigrations: [] });
    await database.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2026-09-01T00:00:00Z'");
    await seedEmailAccount(database);
    const intake = createFinancialEventIntake({ dbClient: database, async fetchPage(account, { end, pageToken }) {
      if (Date.parse(end) > startedAt) return { emails: [], nextPageToken: null, unavailableMessageCount: 0 };
      const page = Number(pageToken || 0) + 1;
      return { emails: [{ uid: `gmail-${account.id}-${page}`, account_id: account.id, account_label: account.label,
        account_email: account.email, from: "Example Market <receipt@example.test>", subject: "Receipt",
        date: "2026-09-01T12:00:00Z", read: true, body_text: "Purchase total $12.00", body_preview: "Purchase total $12.00" }],
      nextPageToken: page < 6 ? String(page) : null, unavailableMessageCount: 0 };
    } });
    const runtime = createTransactionImportRuntime(workerMock, undefined, intake);
    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(0);
      await flushDrain();
      expect((await database.execute("SELECT COUNT(*) AS total FROM ea_financial_documents")).rows[0]?.total).toBe(5);
      expect((await database.execute("SELECT status, page_token FROM ea_financial_intake_state")).rows).toEqual([{ status: "pending", page_token: "5" }]);
      await vi.advanceTimersByTimeAsync(29_999);
      expect((await database.execute("SELECT COUNT(*) AS total FROM ea_financial_documents")).rows[0]?.total).toBe(5);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersToNextTimerAsync();
      await flushDrain();
      expect((await database.execute("SELECT COUNT(*) AS total FROM ea_financial_documents")).rows[0]?.total).toBe(6);
      expect((await database.execute("SELECT status, page_token FROM ea_financial_intake_state")).rows).toEqual([{ status: "waiting", page_token: null }]);
    } finally {
      await runtime.stop();
      database.close();
    }
  });
});
