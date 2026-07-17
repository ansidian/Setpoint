import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import crypto from "crypto";

const {
  __testing__,
  cleanupTodoistWebhookDeliveries,
  handleTodoistWebhookDelivery,
  requestTodoistMirrorSync,
  stopTodoistMirrorSyncWorker,
  startTodoistMirrorSyncWorker,
} = await import("./todoist-webhook.ts");
const {
  __resetCurrentDashboardEventsForTests,
  subscribeCurrentDashboardEvents,
} = await import("../dashboard/current-events.js");

function signPayload(rawBody: Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
}

async function createTodoistWebhookTestDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_todoist_webhook_deliveries (
      delivery_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_name TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      received_at TEXT NOT NULL
    );

    CREATE TABLE ea_todoist_sync_state (
      user_id TEXT PRIMARY KEY,
      sync_token TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      last_sync_at TEXT,
      last_success_at TEXT,
      last_full_sync_at TEXT,
      last_incremental_sync_at TEXT,
      last_error TEXT,
      sync_started_at TEXT,
      sync_requested_at TEXT,
      sync_request_reason TEXT,
      last_check_failed_at TEXT,
      failed_check_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

let testDb: Client = null as unknown as Client;

beforeEach(async () => {
  testDb = await createTodoistWebhookTestDb();
});

afterEach(async () => {
  stopTodoistMirrorSyncWorker();
  __resetCurrentDashboardEventsForTests();
  vi.useRealTimers();
  await testDb?.close?.();
  testDb = null as unknown as Client;
});

describe("handleTodoistWebhookDelivery", () => {
  it("persists a verified delivery and requests mirror sync", async () => {
    const rawBody = Buffer.from(JSON.stringify({
      event_name: "item:updated",
      event_data: { id: "task-1", content: "Changed in Todoist" },
    }));
    const requestSync = vi.fn();

    const result = await handleTodoistWebhookDelivery({
      userId: "u1",
      rawBody,
      headers: {
        "x-todoist-hmac-sha256": signPayload(rawBody, "client-secret"),
        "x-todoist-delivery-id": "delivery-1",
      },
      clientSecret: "client-secret",
      dbClient: testDb,
      requestSync,
      now: new Date("2026-05-04T18:00:00.000Z"),
    });

    expect(result).toEqual({ accepted: true, duplicate: false });
    expect(requestSync).toHaveBeenCalledWith("u1", {
      reason: "todoist-webhook",
    });

    const rows = await testDb.execute("SELECT * FROM ea_todoist_webhook_deliveries");
    expect(rows.rows).toEqual([
      expect.objectContaining({
        delivery_id: "delivery-1",
        user_id: "u1",
        event_name: "item:updated",
        payload_json: rawBody.toString("utf8"),
        received_at: "2026-05-04T18:00:00.000Z",
      }),
    ]);
    const syncState = await testDb.execute("SELECT sync_requested_at, sync_request_reason FROM ea_todoist_sync_state WHERE user_id = 'u1'");
    expect(syncState.rows).toEqual([
      expect.objectContaining({
        sync_requested_at: "2026-05-04T18:00:00.000Z",
        sync_request_reason: "todoist-webhook",
      }),
    ]);
  });

  it("acks duplicate delivery ids without requesting another sync", async () => {
    const rawBody = Buffer.from(JSON.stringify({ event_name: "item:updated" }));
    const headers = {
      "x-todoist-hmac-sha256": signPayload(rawBody, "client-secret"),
      "x-todoist-delivery-id": "delivery-1",
    };
    const requestSync = vi.fn();

    await handleTodoistWebhookDelivery({
      userId: "u1",
      rawBody,
      headers,
      clientSecret: "client-secret",
      dbClient: testDb,
      requestSync,
    });
    const duplicate = await handleTodoistWebhookDelivery({
      userId: "u1",
      rawBody,
      headers,
      clientSecret: "client-secret",
      dbClient: testDb,
      requestSync,
    });

    expect(duplicate).toEqual({ accepted: true, duplicate: true });
    expect(requestSync).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid HMACs before persisting or requesting sync", async () => {
    const requestSync = vi.fn();

    await expect(handleTodoistWebhookDelivery({
      userId: "u1",
      rawBody: Buffer.from("{}"),
      headers: {
        "x-todoist-hmac-sha256": "bad-signature",
        "x-todoist-delivery-id": "delivery-1",
      },
      clientSecret: "client-secret",
      dbClient: testDb,
      requestSync,
    })).rejects.toMatchObject({ status: 401 });

    const rows = await testDb.execute("SELECT * FROM ea_todoist_webhook_deliveries");
    expect(rows.rows).toEqual([]);
    expect(requestSync).not.toHaveBeenCalled();
  });

  it("returns production config failure when the client secret is missing", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      await expect(handleTodoistWebhookDelivery({
        userId: "u1",
        rawBody: Buffer.from("{}"),
        headers: {
          "x-todoist-hmac-sha256": "anything",
          "x-todoist-delivery-id": "delivery-1",
        },
        clientSecret: "",
        dbClient: testDb,
        requestSync: vi.fn(),
      })).rejects.toMatchObject({ status: 503 });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("cleans up delivery records older than 30 days", async () => {
    await testDb.execute({
      sql: `INSERT INTO ea_todoist_webhook_deliveries
              (delivery_id, user_id, event_name, payload_json, received_at)
            VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      args: [
        "old-delivery", "u1", "item:updated", "{}", "2026-04-03T17:59:59.999Z",
        "new-delivery", "u1", "item:updated", "{}", "2026-04-04T18:00:00.000Z",
      ],
    });

    const result = await cleanupTodoistWebhookDeliveries({
      dbClient: testDb,
      now: new Date("2026-05-04T18:00:00.000Z"),
    });

    expect(result).toEqual({ deleted: 1 });
    const rows = await testDb.execute("SELECT delivery_id FROM ea_todoist_webhook_deliveries ORDER BY delivery_id");
    expect(rows.rows.map((row) => row.delivery_id)).toEqual(["new-delivery"]);
  });
});

describe("requestTodoistMirrorSync", () => {
  it("coalesces repeated wakeups before the debounce fires", async () => {
    vi.useFakeTimers();
    const syncFn = vi.fn(async () => ({ status: "current" }));

    requestTodoistMirrorSync("u1", { debounceMs: 50, syncFn });
    requestTodoistMirrorSync("u1", { debounceMs: 50, syncFn });

    await vi.advanceTimersByTimeAsync(50);

    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  it("reruns when a wakeup arrives during an active sync", async () => {
    vi.useFakeTimers();
    let resolveFirst;
    const firstRun = new Promise((resolve) => { resolveFirst = resolve; });
    const syncFn = vi
      .fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValueOnce({ status: "current" });

    requestTodoistMirrorSync("u1", { debounceMs: 0, syncFn });
    await vi.advanceTimersByTimeAsync(0);
    expect(syncFn).toHaveBeenCalledTimes(1);

    requestTodoistMirrorSync("u1", { debounceMs: 0, syncFn });
    resolveFirst!({ status: "current" });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(syncFn).toHaveBeenCalledTimes(2);
  });

  it("publishes a current-dashboard refetch hint when requested sync settles", async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const syncFn = vi.fn(async () => ({ status: "current" }));
    subscribeCurrentDashboardEvents("u1", listener);

    requestTodoistMirrorSync("u1", { debounceMs: 0, syncFn });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "dashboard_current_changed",
      source: "todoist",
      reason: "sync_settled",
      state: "current",
    }));
  });

  it("publishes a degraded refetch hint when requested sync fails", async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const syncFn = vi.fn(async () => {
      throw new Error("Todoist unavailable");
    });
    subscribeCurrentDashboardEvents("u1", listener);

    requestTodoistMirrorSync("u1", { debounceMs: 0, syncFn });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "dashboard_current_changed",
      source: "todoist",
      reason: "sync_settled",
      state: "degraded",
    }));
  });
});

describe("startTodoistMirrorSyncWorker", () => {
  it("requests startup sync when the mirror is stale", async () => {
    const getHealthFn = vi.fn(async () => ({
      configured: true,
      state: "stale" as const,
      lastSuccessAt: "2026-05-04T17:58:00.000Z",
    }));
    const requestSyncFn = vi.fn();

    startTodoistMirrorSyncWorker({
      userId: "u1",
      intervalMs: 5 * 60 * 1000,
      getHealthFn,
      requestSyncFn,
      cleanupFn: vi.fn(async () => ({ deleted: 0 })),
    });
    await Promise.resolve();

    expect(requestSyncFn).toHaveBeenCalledWith("u1", {
      reason: "todoist-startup",
      debounceMs: 0,
      forceFull: false,
    });
  });

  it("requests backstop sync on the interval", async () => {
    vi.useFakeTimers();
    const requestSyncFn = vi.fn();

    startTodoistMirrorSyncWorker({
      userId: "u1",
      intervalMs: 300_000,
      getHealthFn: vi.fn(async () => ({ configured: true, state: "current" as const })),
      requestSyncFn,
      cleanupFn: vi.fn(async () => ({ deleted: 0 })),
    });
    await vi.advanceTimersByTimeAsync(300_000);

    expect(requestSyncFn).toHaveBeenCalledWith("u1", {
      reason: "todoist-backstop",
    });
  });
});
