import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import crypto from "crypto";

const {
  __testing__,
  cleanupTodoistWebhookDeliveries,
  handleTodoistWebhookDelivery,
  requestTodoistMirrorSync,
  stopTodoistMirrorSyncWorker,
  startTodoistMirrorSyncWorker,
} = await import("./todoist-webhook.js");

function signPayload(rawBody, secret) {
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
  `);
  return db;
}

let testDb;

beforeEach(async () => {
  testDb = await createTodoistWebhookTestDb();
});

afterEach(async () => {
  stopTodoistMirrorSyncWorker();
  vi.useRealTimers();
  await testDb?.close?.();
  testDb = null;
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
    resolveFirst({ status: "current" });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(syncFn).toHaveBeenCalledTimes(2);
  });
});

describe("startTodoistMirrorSyncWorker", () => {
  it("requests startup sync when the mirror is stale", async () => {
    const getHealthFn = vi.fn(async () => ({
      configured: true,
      state: "stale",
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
      getHealthFn: vi.fn(async () => ({ configured: true, state: "current" })),
      requestSyncFn,
      cleanupFn: vi.fn(async () => ({ deleted: 0 })),
    });
    await vi.advanceTimersByTimeAsync(300_000);

    expect(requestSyncFn).toHaveBeenCalledWith("u1", {
      reason: "todoist-backstop",
    });
  });
});
