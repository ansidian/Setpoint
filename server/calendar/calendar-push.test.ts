import { createClient, type Client } from "@libsql/client";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "../test-utils/supertest.ts";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";

const database = vi.hoisted(() => ({ current: null as Client | null }));
// test-architecture: allow-boundary-mock -- The shared database connection is the external persistence boundary; all Calendar collaborators use one real temporary database, including transactions and incremental sync.
vi.mock("../db/connection.ts", () => ({
  default: new Proxy({} as Client, {
    get(_target, key) {
      const value = Reflect.get(database.current!, key);
      return typeof value === "function" ? value.bind(database.current) : value;
    },
  }),
}));

import { encrypt } from "../platform/encryption.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";
import { clearCurrentDashboardRefreshState } from "../dashboard/current-service.ts";
import { refreshRows } from "../dashboard/currentRefreshRunner.ts";
import { drainCalendarPushSync, startCalendarPushWorker, stopCalendarPushWorker } from "./calendar-push.ts";
import { requestCalendarPushSync, getCalendarPushHealth } from "./calendar-push-channels.ts";
import { invalidateCalendarListCache } from "./calendar-google-client.ts";
import calendarPushRouter from "../routes/calendar-push.ts";

const userId = "calendar-owner";
const accountId = "google-account";
const now = Date.parse("2026-09-12T16:00:00.000Z");
let tempDir: string;
const event = (title = "Planning") => ({
  id: "event-1", summary: title, location: "Library",
  start: { dateTime: "2026-09-12T18:00:00Z" },
  end: { dateTime: "2026-09-12T19:00:00Z" },
});

type GoogleEvents = (url: URL) => Promise<Response>;
function googleResponses(events: GoogleEvents = async () => Response.json({ items: [event()], nextSyncToken: "cursor-1" })) {
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.origin !== "https://www.googleapis.com") throw new Error("Unexpected external provider");
    if (url.pathname.endsWith("/users/me/calendarList")) {
      return Response.json({ items: [{ id: "primary", summary: "Personal", primary: true, selected: true, accessRole: "owner" }] });
    }
    if (url.pathname.endsWith("/calendars/primary/events")) return events(url);
    throw new Error("Unexpected Google endpoint");
  });
}

async function queueState() {
  return (await database.current!.execute("SELECT * FROM ea_calendar_push_sync")).rows[0];
}

async function displayedCalendar() {
  const result = await database.current!.execute("SELECT payload_json FROM ea_current_data_cache WHERE cache_key = 'calendar_current'");
  return JSON.parse(String(result.rows[0]?.payload_json || "[]"));
}

beforeEach(async () => {
  vi.stubEnv("EA_ENCRYPTION_KEY", "12".repeat(32));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  tempDir = await createTestTempDir("calendar-push-runtime-");
  database.current = createClient({ url: pathToFileURL(join(tempDir, "calendar.db")).href });
  for (const migration of ["001_ea_tables.sql", "011_calendar_search_mirror.sql", "028_provider_needs_reauth.sql", "049_calendar_mirror_snapshot_hash.sql", "074_calendar_push.sql"]) {
    await database.current.executeMultiple(readFileSync(new URL(`../db/migrations/${migration}`, import.meta.url), "utf8"));
  }
  await database.current.execute({
    sql: `INSERT INTO ea_accounts (id, user_id, type, email, label, calendar_enabled, credentials_encrypted)
          VALUES (?, ?, 'gmail', 'owner@example.com', 'Google', 1, ?)`,
    args: [accountId, userId, encrypt(JSON.stringify({ access_token: "test-access", expires_at: now + 86_400_000,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
    }), accountCredentialContext(accountId))],
  });
  invalidateCalendarListCache();
  googleResponses();
});

afterEach(async () => {
  await stopCalendarPushWorker();
  clearCurrentDashboardRefreshState();
  database.current?.close();
  database.current = null;
  await removeTempDir(tempDir);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("durable Calendar provider synchronization", () => {
  it("consumes persisted work through the real mirror and current-calendar cache", async () => {
    await requestCalendarPushSync(userId);
    expect(await drainCalendarPushSync(userId)).toBe(1);
    expect(await queueState()).toMatchObject({ requested_revision: 1, completed_revision: 1, last_error: null, failure_count: 0 });
    expect(await displayedCalendar()).toEqual([expect.objectContaining({ id: "event-1", title: "Planning" })]);
    const mirror = await database.current!.execute("SELECT title FROM ea_calendar_search_occurrences WHERE deleted_at IS NULL");
    expect(mirror.rows).toEqual([{ title: "Planning" }]);
  });

  it("does not consume a notification that arrives during an older provider fetch", async () => {
    let release!: (response: Response) => void;
    let announce!: () => void;
    const started = new Promise<void>((resolve) => { announce = resolve; });
    let first = true;
    googleResponses(async () => {
      if (first) {
        first = false;
        announce();
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return Response.json({ items: [event("Renamed externally")], nextSyncToken: "cursor-2" });
    });
    await requestCalendarPushSync(userId);
    const drain = drainCalendarPushSync(userId);
    await started;
    await requestCalendarPushSync(userId);
    release(Response.json({ items: [event("Old title")], nextSyncToken: "cursor-1" }));
    await drain;
    expect(await queueState()).toMatchObject({ requested_revision: 2, completed_revision: 2 });
    const mirror = await database.current!.execute("SELECT title FROM ea_calendar_search_occurrences WHERE deleted_at IS NULL");
    expect(mirror.rows).toEqual([{ title: "Renamed externally" }]);
    expect(await displayedCalendar()).toEqual([expect.objectContaining({ title: "Renamed externally" })]);
  });

  it("retains failed work and saved data, then clears failure only after successful retry", async () => {
    await requestCalendarPushSync(userId);
    await drainCalendarPushSync(userId);
    googleResponses(async () => Response.json({ error: { message: "Temporarily unavailable" } }, { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await requestCalendarPushSync(userId);
    expect(await drainCalendarPushSync(userId)).toBe(0);
    expect(await queueState()).toMatchObject({ requested_revision: 2, completed_revision: 1, failure_count: 1 });
    expect((await getCalendarPushHealth(userId)).state).toBe("degraded");
    expect(await displayedCalendar()).toEqual([expect.objectContaining({ title: "Planning" })]);
    vi.setSystemTime(now + 60_001);
    googleResponses(async () => Response.json({ items: [event("Recovered")], nextSyncToken: "cursor-2" }));
    await drainCalendarPushSync(userId);
    expect(await queueState()).toMatchObject({ requested_revision: 2, completed_revision: 2, failure_count: 0, last_error: null });
    expect(await displayedCalendar()).toEqual([expect.objectContaining({ title: "Recovered" })]);
  });

  it("keeps the job pending when mirror sync succeeds but the dashboard refresh fails", async () => {
    await requestCalendarPushSync(userId);
    await drainCalendarPushSync(userId);
    googleResponses(async (url) => url.searchParams.has("showDeleted")
      ? Response.json({ items: [event("Updated mirror")], nextSyncToken: "cursor-2" })
      : Response.json({ error: { message: "Try again" } }, { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await requestCalendarPushSync(userId);
    await drainCalendarPushSync(userId);
    expect(await queueState()).toMatchObject({ requested_revision: 2, completed_revision: 1, failure_count: 1 });
    expect(await displayedCalendar()).toEqual([expect.objectContaining({ title: "Planning" })]);
    const cache = await database.current!.execute("SELECT status FROM ea_current_data_cache WHERE cache_key = 'calendar_current'");
    expect(cache.rows).toEqual([{ status: "degraded" }]);
  });

  it("refreshes after an older dashboard read instead of treating it as the pushed change", async () => {
    let announce!: () => void;
    let release!: (response: Response) => void;
    const started = new Promise<void>((resolve) => { announce = resolve; });
    let first = true;
    googleResponses(async (url) => {
      if (!url.searchParams.has("showDeleted") && first) {
        first = false;
        announce();
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return Response.json({ items: [event("Pushed title")], nextSyncToken: "cursor-2" });
    });
    // Cold dashboard reads and force sync call this direct runner path, without
    // entering the background-refresh admission map.
    const olderRead = refreshRows(userId, {}, ["calendar_current"]);
    await started;
    await requestCalendarPushSync(userId);
    const drain = drainCalendarPushSync(userId);
    // Let the new push proceed through its provider/cache microtasks while the
    // older direct read remains outstanding. It must still write after that read.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release(Response.json({ items: [event("Before notification")] }));
    await Promise.all([olderRead, drain]);
    expect(await displayedCalendar()).toEqual([expect.objectContaining({ title: "Pushed title" })]);
    expect(await queueState()).toMatchObject({ requested_revision: 1, completed_revision: 1 });
  });

  it("recovers provider changes periodically when no notification is delivered", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    startCalendarPushWorker({ userId });
    await vi.waitFor(async () => expect(await queueState()).toMatchObject({ completed_revision: 1 }));
    googleResponses(async () => Response.json({ items: [event("Missed push recovered")], nextSyncToken: "cursor-2" }));
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    await vi.waitFor(async () => expect(await displayedCalendar()).toEqual([expect.objectContaining({ title: "Missed push recovered" })]));
    expect(await queueState()).toMatchObject({ requested_revision: 2, completed_revision: 2, last_error: null });
  });
});

describe("bodyless Calendar callback", () => {
  async function registeredChannel() {
    await database.current!.execute({
      sql: `INSERT INTO ea_calendar_push_channels
            (channel_id, user_id, account_id, kind, calendar_id, callback_url, token_hash, resource_id, status, created_at, expires_at)
            VALUES ('channel-1', ?, ?, 'events', 'primary', 'https://setpoint.example/api/calendar/push', ?, 'resource-1', 'active', ?, ?)`,
      args: [userId, accountId, createHash("sha256").update("channel-secret").digest("hex"), now, now + 86_400_000],
    });
    return {
      "X-Goog-Channel-ID": "channel-1", "X-Goog-Channel-Token": "channel-secret",
      "X-Goog-Resource-ID": "resource-1", "X-Goog-Resource-State": "exists", "X-Goog-Message-Number": "2",
      "X-Goog-Resource-URI": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    };
  }

  it("authenticates the channel without a cookie, body, or browser CSRF header", async () => {
    const app = express().use("/api/calendar/push", calendarPushRouter);
    const headers = await registeredChannel();
    expect((await request(app).post("/api/calendar/push").set(headers)).status).toBe(204);
    expect(await queueState()).toMatchObject({ requested_revision: 1, completed_revision: 0 });
    expect((await request(app).post("/api/calendar/push").set({ ...headers, "X-Goog-Channel-Token": "wrong" })).status).toBe(401);
    expect(await queueState()).toMatchObject({ requested_revision: 1 });
  });

  it("returns a retryable failure and rolls back receipt when durable enqueue fails", async () => {
    const app = express().use("/api/calendar/push", calendarPushRouter);
    const headers = await registeredChannel();
    await database.current!.execute("DROP TABLE ea_calendar_push_sync");
    expect((await request(app).post("/api/calendar/push").set(headers)).status).toBe(503);
    const receipt = await database.current!.execute("SELECT last_notification_at FROM ea_calendar_push_channels");
    expect(receipt.rows).toEqual([{ last_notification_at: null }]);
  });
});
