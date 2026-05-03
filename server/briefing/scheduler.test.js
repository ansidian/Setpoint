import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = { execute: vi.fn() };
const cronApi = vi.hoisted(() => ({ schedule: vi.fn() }));
const briefingApi = vi.hoisted(() => ({
  generateBriefing: vi.fn(),
  loadUserConfig: vi.fn(),
  fetchAllEmails: vi.fn(),
}));
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
}));

vi.mock("node-cron", () => ({ default: cronApi }));
vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./index.js", () => briefingApi);
vi.mock("./snapshot-service.js", () => snapshotApi);
vi.mock("./email-index.js", () => ({ indexEmails: vi.fn() }));
vi.mock("./gmail-sync.js", () => gmailSyncApi);
vi.mock("./triage-worker.js", () => triageWorkerApi);

const { initScheduler } = await import("./scheduler.js");

beforeEach(() => {
  vi.clearAllMocks();
  cronApi.schedule.mockImplementation(() => ({ stop: vi.fn() }));
});

describe("initScheduler", () => {
  it("treats saved schedules as snapshot boundaries instead of batch briefing generation", async () => {
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
    expect(briefingApi.generateBriefing).not.toHaveBeenCalled();
  });
});
