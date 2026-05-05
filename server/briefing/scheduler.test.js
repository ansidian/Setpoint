import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = { execute: vi.fn() };
const cronApi = vi.hoisted(() => ({ schedule: vi.fn() }));
const configApi = vi.hoisted(() => ({ loadUserConfig: vi.fn() }));
const emailFetchApi = vi.hoisted(() => ({ fetchAllEmails: vi.fn() }));
const snapshotApi = vi.hoisted(() => ({
  advanceSnapshotBoundary: vi.fn(async () => ({ snapshot: { id: 42, status: "active" } })),
}));
const gmailSyncApi = vi.hoisted(() => ({
  enqueueEmailTriageForEmails: vi.fn(),
  processNextGmailHistorySyncJob: vi.fn(),
  renewDueGmailWatches: vi.fn(),
}));
const triageWorkerApi = vi.hoisted(() => ({
  processNextEmailTriageJob: vi.fn(),
  recoverStaleRunningTriageJobs: vi.fn(),
}));

vi.mock("node-cron", () => ({ default: cronApi }));
vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./config-service.js", () => configApi);
vi.mock("./email-fetch.js", () => emailFetchApi);
vi.mock("./snapshot-service.js", () => snapshotApi);
vi.mock("./email-index.js", () => ({ indexEmails: vi.fn() }));
vi.mock("./gmail-sync.js", () => gmailSyncApi);
vi.mock("./triage-worker.js", () => triageWorkerApi);

const { initScheduler, runEmailTriageWorker } = await import("./scheduler.js");

beforeEach(() => {
  vi.clearAllMocks();
  cronApi.schedule.mockImplementation(() => ({ stop: vi.fn() }));
  triageWorkerApi.recoverStaleRunningTriageJobs.mockResolvedValue({ recovered: 0 });
});

describe("initScheduler", () => {
  it("treats saved schedules as snapshot boundaries instead of batch generation", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        user_id: "user-1",
        schedules_json: JSON.stringify([
          { label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true },
        ]),
      }],
    });

    await initScheduler();

    expect(cronApi.schedule).toHaveBeenCalledWith(
      "30 8 * * *",
      expect.any(Function),
      { timezone: "America/Los_Angeles" },
    );

    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        schedules_json: JSON.stringify([
          { label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true },
        ]),
      }],
    });
    await cronApi.schedule.mock.calls[0][1]();

    expect(snapshotApi.advanceSnapshotBoundary).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        timeZone: "America/Los_Angeles",
        scheduleLabel: "Morning",
      }),
    );
    expect(snapshotApi.advanceSnapshotBoundary).toHaveBeenCalledTimes(1);
  });
});

describe("email triage scheduler worker", () => {
  it("stops the batch loop cleanly when triage mode is paused", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    triageWorkerApi.processNextEmailTriageJob.mockResolvedValueOnce({
      processed: false,
      paused: true,
    });

    await runEmailTriageWorker();

    expect(triageWorkerApi.recoverStaleRunningTriageJobs).toHaveBeenCalledTimes(1);
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
