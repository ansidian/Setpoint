import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../platform/encryption.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";
import { createTestTempDir, removeTempDirSync } from "../test-utils/temp-dir.ts";
import {
  acceptCalendarPushNotification,
  getCalendarPushHealth,
  reconcileCalendarPushWatches,
  requestCalendarPushSync,
  type CalendarPushHeaders,
} from "./calendar-push-channels.ts";

const callbackUrl = "https://setpoint.example/api/calendar/push";
const DAY_MS = 86_400_000;
const nowMs = Date.now();
type Watch = { id: string; token: string; address: string; expiration: string; resourceId: string; resourceUri: string };
let db: Client;
let tempDir: string;
let issued: Watch[];
let stopped: string[];
let items: Array<{ id: string; selected?: boolean; hidden?: boolean }>;
let discoveryFailure: boolean;
let registrationFailure: boolean;
let registrationRejection: { status: number; reason: string } | undefined;
let unsupportedCalendars: Set<string>;
let onWatch: ((watch: Watch) => Promise<void>) | undefined;

function headers(watch: Watch, overrides: CalendarPushHeaders = {}): CalendarPushHeaders {
  return {
    "x-goog-channel-id": watch.id,
    "x-goog-channel-token": watch.token,
    "x-goog-resource-id": watch.resourceId,
    "x-goog-resource-uri": watch.resourceUri,
    "x-goog-resource-state": "exists",
    "x-goog-message-number": "12",
    ...overrides,
  };
}

async function seedAccount({ id = "account-1", email = "owner@example.com", calendarEnabled = 1,
  scopes = ["calendar.readonly", "calendar.events"], updatedAt = "2026-09-01 00:00:00" } = {}) {
  const credentials = encrypt(JSON.stringify({
    access_token: "fixture-access-token", refresh_token: "fixture-refresh-token",
    expires_at: Date.now() + 90 * DAY_MS,
    scopes: scopes.map((scope) => `https://www.googleapis.com/auth/${scope}`),
  }), accountCredentialContext(id));
  await db.execute({
    sql: `INSERT INTO ea_accounts
            (id, user_id, type, email, label, credentials_encrypted, calendar_enabled, updated_at)
          VALUES (?, 'owner', 'gmail', ?, 'Calendar', ?, ?, ?)`,
    args: [id, email, credentials, calendarEnabled, updatedAt],
  });
}

async function channels() {
  return (await db.execute("SELECT * FROM ea_calendar_push_channels ORDER BY rowid")).rows;
}

async function queue() {
  return (await db.execute("SELECT * FROM ea_calendar_push_sync WHERE user_id = 'owner'")).rows[0];
}

async function reconcile(at = nowMs, address = callbackUrl) {
  return reconcileCalendarPushWatches("owner", { dbClient: db, callbackUrl: address, nowMs: at });
}

beforeEach(async () => {
  vi.stubEnv("EA_ENCRYPTION_KEY", "ab".repeat(32));
  tempDir = await createTestTempDir("calendar-push-");
  db = createClient({ url: `file:${join(tempDir, "calendar.db")}` });
  for (const migration of ["001_ea_tables.sql", "028_provider_needs_reauth.sql", "074_calendar_push.sql", "075_calendar_push_unsupported.sql"]) {
    await db.executeMultiple(readFileSync(new URL(`../db/migrations/${migration}`, import.meta.url), "utf8"));
  }
  issued = [];
  stopped = [];
  items = [{ id: "primary" }];
  discoveryFailure = false;
  registrationFailure = false;
  registrationRejection = undefined;
  unsupportedCalendars = new Set();
  onWatch = undefined;
  // Google HTTPS is the external boundary; real channel policy, encryption,
  // account canonicalization, and SQLite commits work together in these cases.
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== "https://www.googleapis.com") throw new Error("Unexpected provider origin");
    if (url.pathname.endsWith("/calendarList") && init?.method === "GET") {
      if (discoveryFailure) return Response.json({ error: { code: 503, message: "private provider detail" } }, { status: 503 });
      return Response.json({ items });
    }
    if (url.pathname.endsWith("/watch")) {
      const body = JSON.parse(String(init?.body));
      const resourceUri = `${url.href.slice(0, -6)}?alt=json`;
      const watch = { ...body, resourceUri,
        resourceId: createHash("sha256").update(resourceUri).digest("hex").slice(0, 24) } as Watch;
      issued.push(watch);
      if (registrationRejection) return Response.json({ error: {
        code: registrationRejection.status, message: "Registration rejected",
        errors: [{ reason: registrationRejection.reason }],
      } }, { status: registrationRejection.status });
      const calendarId = decodeURIComponent(url.pathname.match(/\/calendars\/([^/]+)\/events\/watch$/)?.[1] || "");
      if (unsupportedCalendars.has(calendarId)) return Response.json({ error: {
        code: 400, message: "Push notifications are not supported by this resource.",
        errors: [{ domain: "calendar", reason: "pushNotSupportedForRequestedResource" }],
      } }, { status: 400 });
      if (registrationFailure) return Response.json({ error: { code: 503, message: `private ${watch.token}` } }, { status: 503 });
      await onWatch?.(watch);
      return Response.json(watch);
    }
    if (url.pathname.endsWith("/channels/stop")) {
      stopped.push(JSON.parse(String(init?.body)).id);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Google request ${url.pathname}`);
  });
  await seedAccount();
});

afterEach(() => {
  db.close();
  removeTempDirSync(tempDir);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Calendar push lifecycle and durable notification admission", () => {
  it("keeps unsupported holiday calendars on periodic sync without a registration warning or retry churn", async () => {
    const holiday = "en.usa#holiday@group.v.calendar.google.com";
    items = [{ id: "primary" }, { id: holiday }];
    unsupportedCalendars.add(holiday);
    await db.execute({
      sql: `INSERT INTO ea_calendar_push_watch_state
              (user_id, account_id, last_attempt_at, expected_channels, failure_count, last_error)
            VALUES ('owner', 'account-1', ?, 3, 11, ?)`,
      args: [nowMs - 60_000, "Google Calendar push registration could not be refreshed. Automatic retry is pending."],
    });
    await reconcile();
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs })).toMatchObject({
      state: "current", activeChannels: 2,
    });
    db.close();
    db = createClient({ url: `file:${join(tempDir, "calendar.db")}` });
    expect(await reconcile(nowMs + 60 * 60_000)).toMatchObject({ registered: 0, failed: 0 });
    expect((await channels()).filter((row) => row.calendar_id === holiday)).toHaveLength(1);
    expect((await db.execute("SELECT last_error, failure_count, expected_channels FROM ea_calendar_push_watch_state")).rows)
      .toEqual([{ last_error: null, failure_count: 0, expected_channels: 2 }]);
  });

  it.each([
    { status: 400, reason: "invalidArgument" },
    { status: 403, reason: "pushNotSupportedForRequestedResource" },
  ])("keeps registration errors visible unless Google explicitly reports unsupported push: $status/$reason", async (rejection) => {
    registrationRejection = rejection;
    expect(await reconcile()).toMatchObject({ failed: 2 });
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs })).toMatchObject({ state: "degraded" });
    expect((await channels()).every((row) => row.push_unsupported === 0)).toBe(true);
    registrationRejection = undefined;
    expect(await reconcile(nowMs + 60_000)).toMatchObject({ registered: 2, failed: 0 });
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs: nowMs + 60_000 })).toMatchObject({ state: "current" });
  });

  it("rechecks unsupported push after its capability cache expires", async () => {
    const holiday = "en.usa#holiday@group.v.calendar.google.com";
    items.push({ id: holiday });
    unsupportedCalendars.add(holiday);
    await reconcile();
    unsupportedCalendars.clear();
    expect(await reconcile(nowMs + 7 * DAY_MS)).toMatchObject({ registered: 3, failed: 0 });
    expect((await channels()).filter((row) => row.calendar_id === holiday && row.status === "active")).toHaveLength(1);
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs: nowMs + 7 * DAY_MS }))
      .toMatchObject({ state: "current", activeChannels: 3 });
  });

  it("registers selected event collections and the granted CalendarList once, without storing bearer tokens", async () => {
    items = [{ id: "primary" }, { id: "work@example.com" }, { id: "hidden", hidden: true }, { id: "unselected", selected: false }];
    expect(await reconcile()).toMatchObject({ registered: 3, failed: 0 });
    expect(await reconcile(nowMs + 60_000)).toMatchObject({ registered: 0, stopped: 0, failed: 0 });
    const rows = await channels();
    expect(rows.map((row) => [row.kind, row.calendar_id, row.status])).toEqual([
      ["events", "primary", "active"], ["events", "work@example.com", "active"], ["calendar_list", "", "active"],
    ]);
    for (const watch of issued) {
      expect(rows.find((row) => row.channel_id === watch.id)?.token_hash)
        .toBe(createHash("sha256").update(watch.token).digest("hex"));
      expect(JSON.stringify(rows)).not.toContain(watch.token);
    }
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs })).toEqual({
      state: "current", activeChannels: 3, lastNotificationAt: null,
    });
  });

  it("does not register automatically outside production or request an additional CalendarList scope", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await reconcileCalendarPushWatches("owner", { dbClient: db, nowMs })).toMatchObject({ skipped: true });
    expect(await channels()).toEqual([]);
    await db.execute("DELETE FROM ea_accounts");
    await seedAccount({ scopes: ["calendar.events"] });
    expect(await reconcile()).toMatchObject({ registered: 1 });
    expect((await channels()).map((row) => row.kind)).toEqual(["events"]);
  });

  it("rejects malformed, forged, wrong-resource, and overlong bodyless notifications without queuing work", async () => {
    await reconcile();
    const watch = issued[0]!;
    for (const overrides of [
      { "x-goog-channel-id": "unknown" }, { "x-goog-channel-token": "wrong" },
      { "x-goog-channel-token": [watch.token, watch.token] },
      { "x-goog-resource-id": "wrong" }, { "x-goog-resource-uri": "https://evil.example/calendar/v3/calendars/primary/events" },
      { "x-goog-resource-state": "deleted" }, { "x-goog-message-number": "-1" },
      { "x-goog-message-number": "9".repeat(21) }, { "x-goog-resource-id": "r".repeat(1025) },
      { "x-goog-resource-state": "sync", "x-goog-message-number": "2" },
    ]) {
      expect(await acceptCalendarPushNotification(headers(watch, overrides), { dbClient: db, nowMs })).toEqual({ accepted: false });
    }
    expect(await queue()).toBeUndefined();
    expect((await channels()).every((row) => row.last_notification_at == null)).toBe(true);
  });

  it("accepts Google's initial sync before the watch response and commits work before acknowledging it", async () => {
    onWatch = async (watch) => {
      const pending = (await channels()).find((row) => row.channel_id === watch.id);
      expect(pending).toMatchObject({ status: "pending", resource_id: null });
      expect(await acceptCalendarPushNotification(headers(watch, {
        "x-goog-resource-state": "sync", "x-goog-message-number": "1",
      }), { dbClient: db, nowMs })).toMatchObject({ accepted: true, userId: "owner", queued: true });
      expect(await queue()).toMatchObject({ completed_revision: 0, requested_at: nowMs });
    };
    await reconcile();
    expect(await queue()).toMatchObject({ requested_revision: 2, completed_revision: 0 });
    expect((await channels()).every((row) => row.status === "active" && row.last_notification_at === nowMs)).toBe(true);
  });

  it("coalesces duplicate and out-of-order deliveries while preserving arrivals during an in-flight sync", async () => {
    await reconcile();
    const watch = issued[0]!;
    await acceptCalendarPushNotification(headers(watch), { dbClient: db, nowMs });
    const inFlightRevision = Number((await queue())?.requested_revision);
    for (const message of ["12", "7", "9007199254740993123"]) {
      expect(await acceptCalendarPushNotification(headers(watch, { "x-goog-message-number": message }), { dbClient: db, nowMs }))
        .toMatchObject({ accepted: true, queued: true });
    }
    await db.execute({ sql: "UPDATE ea_calendar_push_sync SET completed_revision = ?", args: [inFlightRevision] });
    expect(await queue()).toMatchObject({ requested_revision: 4, completed_revision: 1 });
    await requestCalendarPushSync("owner", nowMs + 1000, { dbClient: db });
    expect(await queue()).toMatchObject({ requested_revision: 5, completed_revision: 1, requested_at: nowMs + 1000 });
  });

  it("asks for discovery after an authenticated CalendarList notification", async () => {
    await reconcile();
    const listWatch = issued.find((watch) => new URL(watch.resourceUri).pathname.endsWith("/calendarList"))!;
    expect(await acceptCalendarPushNotification(headers(listWatch), { dbClient: db, nowMs }))
      .toMatchObject({ accepted: true, reconcile: true });
    items.push({ id: "new-calendar" });
    expect(await reconcile(nowMs + 1000)).toMatchObject({ registered: 1 });
    expect((await channels()).find((row) => row.calendar_id === "new-calendar")).toMatchObject({ status: "active" });
  });

  it("keeps old watches valid during renewal, then retires them after replacements succeed", async () => {
    await reconcile();
    const oldWatches = [...issued];
    const renewalTime = nowMs + 6 * DAY_MS;
    onWatch = async (watch) => {
      const old = oldWatches.find((entry) => entry.resourceUri === watch.resourceUri)!;
      expect(await acceptCalendarPushNotification(headers(old), { dbClient: db, nowMs: renewalTime })).toMatchObject({ accepted: true });
      expect(await acceptCalendarPushNotification(headers(watch, {
        "x-goog-resource-state": "sync", "x-goog-message-number": "1",
      }), { dbClient: db, nowMs: renewalTime })).toMatchObject({ accepted: true });
    };
    expect(await reconcile(renewalTime)).toMatchObject({ registered: 2, stopped: 2, failed: 0 });
    expect((await channels()).filter((row) => row.status === "active")).toHaveLength(2);
    for (const old of oldWatches) {
      expect(await acceptCalendarPushNotification(headers(old), { dbClient: db, nowMs: renewalTime })).toEqual({ accepted: false });
    }
    // The simulated provider records which channel subscriptions were stopped.
    expect(stopped.sort()).toEqual(oldWatches.map((watch) => watch.id).sort());
  });

  it("preserves working watches on renewal failure, records sanitized evidence, and recovers on retry", async () => {
    await reconcile();
    const oldWatch = issued[0]!;
    const renewalTime = nowMs + 6 * DAY_MS;
    registrationFailure = true;
    expect(await reconcile(renewalTime)).toMatchObject({ registered: 0, stopped: 0, failed: 2 });
    expect(await acceptCalendarPushNotification(headers(oldWatch), { dbClient: db, nowMs: renewalTime })).toMatchObject({ accepted: true });
    const failedHealth = await getCalendarPushHealth("owner", { dbClient: db, nowMs: renewalTime });
    expect(failedHealth).toMatchObject({ state: "degraded", activeChannels: 2 });
    expect(failedHealth.message).not.toContain("private");
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs: nowMs + 8 * DAY_MS }))
      .toMatchObject({ state: "degraded", activeChannels: 0 });
    registrationFailure = false;
    expect(await reconcile(renewalTime + 60_000)).toMatchObject({ registered: 2, stopped: 2, failed: 0 });
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs: renewalTime + 60_000 })).toMatchObject({ state: "current" });
    expect((await db.execute("SELECT last_error, failure_count FROM ea_calendar_push_watch_state")).rows[0])
      .toMatchObject({ last_error: null, failure_count: 0 });
  });

  it("never retires existing watches on incomplete discovery but removes deselected calendars after a complete list", async () => {
    items.push({ id: "work" });
    await reconcile();
    discoveryFailure = true;
    expect(await reconcile(nowMs + 1000)).toMatchObject({ registered: 0, stopped: 0, failed: 1 });
    expect((await channels()).filter((row) => row.status === "active")).toHaveLength(3);
    discoveryFailure = false;
    items = [{ id: "primary" }, { id: "work", selected: false }];
    expect(await reconcile(nowMs + 2000)).toMatchObject({ stopped: 1, failed: 0 });
    expect((await channels()).find((row) => row.calendar_id === "work")).toMatchObject({ status: "retired" });
  });

  it("rejects disabled, removed, transferred, reconnect-required, noncanonical, and expired accounts", async () => {
    await reconcile();
    const watch = issued[0]!;
    for (const mutation of [
      "UPDATE ea_accounts SET calendar_enabled = 0", "UPDATE ea_accounts SET needs_reauth = 1",
      "UPDATE ea_accounts SET user_id = 'someone-else'", "UPDATE ea_accounts SET credentials_encrypted = NULL",
    ]) {
      const account = (await db.execute("SELECT * FROM ea_accounts")).rows[0]!;
      await db.execute(mutation);
      expect(await acceptCalendarPushNotification(headers(watch), { dbClient: db, nowMs })).toEqual({ accepted: false });
      await db.execute({ sql: "UPDATE ea_accounts SET calendar_enabled = 1, needs_reauth = 0, user_id = 'owner', credentials_encrypted = ?",
        args: [account.credentials_encrypted!] });
    }
    await seedAccount({ id: "newer-canonical", updatedAt: "2026-09-02 00:00:00" });
    expect(await acceptCalendarPushNotification(headers(watch), { dbClient: db, nowMs })).toEqual({ accepted: false });
    await db.execute("DELETE FROM ea_accounts WHERE id = 'newer-canonical'");
    expect(await acceptCalendarPushNotification(headers(watch), { dbClient: db, nowMs: nowMs + 7 * DAY_MS })).toEqual({ accepted: false });
    await db.execute("DELETE FROM ea_accounts");
    expect(await acceptCalendarPushNotification(headers(watch), { dbClient: db, nowMs })).toEqual({ accepted: false });
    expect(await queue()).toBeUndefined();
  });

  it("replaces the callback address and stops channels when their account is disabled", async () => {
    await reconcile();
    const movedUrl = "https://moved.example/api/calendar/push";
    expect(await reconcile(nowMs + 1000, movedUrl)).toMatchObject({ registered: 2, stopped: 2 });
    expect((await channels()).filter((row) => row.status === "active").every((row) => row.callback_url === movedUrl)).toBe(true);
    await db.execute("UPDATE ea_accounts SET calendar_enabled = 0");
    expect(await reconcile(nowMs + 2000, movedUrl)).toMatchObject({ registered: 0, stopped: 2 });
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs })).toMatchObject({ state: "inactive" });
  });

  it("surfaces durable synchronization failures without exposing raw error text as health", async () => {
    await requestCalendarPushSync("owner", nowMs, { dbClient: db });
    await db.execute("UPDATE ea_calendar_push_sync SET last_error = 'private provider response', failure_count = 1");
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs })).toMatchObject({
      state: "degraded", message: "Calendar synchronization failed. Automatic retry is pending.", lastNotificationAt: null,
    });
    await db.execute("UPDATE ea_calendar_push_sync SET last_error = NULL, failure_count = 0");
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs })).toMatchObject({ state: "inactive" });
  });

  it("retains channel authentication and pending work across a database reconnect", async () => {
    await reconcile();
    const watch = issued[0]!;
    await acceptCalendarPushNotification(headers(watch), { dbClient: db, nowMs });
    db.close();
    db = createClient({ url: `file:${join(tempDir, "calendar.db")}` });
    expect(await reconcile(nowMs + 1000)).toMatchObject({ registered: 0 });
    expect(await queue()).toMatchObject({ requested_revision: 1, completed_revision: 0 });
    expect(await acceptCalendarPushNotification(headers(watch), { dbClient: db, nowMs: nowMs + 1000 }))
      .toMatchObject({ accepted: true, queued: true });
    expect(await queue()).toMatchObject({ requested_revision: 2, completed_revision: 0 });
  });

  it("detects an expired event watch even while the account's CalendarList watch remains active", async () => {
    await reconcile();
    await db.execute({ sql: "UPDATE ea_calendar_push_channels SET expires_at = ? WHERE kind = 'events'", args: [nowMs - 1] });
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs })).toMatchObject({ state: "degraded", activeChannels: 1 });
    expect(await reconcile(nowMs + 1000)).toMatchObject({ registered: 1 });
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs: nowMs + 1000 })).toMatchObject({ state: "current", activeChannels: 2 });
  });

  it("recovers a registration interrupted before a response without accepting unknown event notifications", async () => {
    registrationFailure = true;
    await reconcile();
    const abandoned = issued[0]!;
    await db.execute({ sql: "UPDATE ea_calendar_push_channels SET status = 'pending', created_at = ? WHERE channel_id = ?",
      args: [nowMs - 11 * 60_000, abandoned.id] });
    expect(await acceptCalendarPushNotification(headers(abandoned), { dbClient: db, nowMs })).toEqual({ accepted: false });
    registrationFailure = false;
    expect(await reconcile(nowMs + 1000)).toMatchObject({ registered: 2 });
    expect((await channels()).find((row) => row.channel_id === abandoned.id)).toMatchObject({ status: "retired" });
    expect(await getCalendarPushHealth("owner", { dbClient: db, nowMs: nowMs + 1000 })).toMatchObject({ state: "current" });
  });
});
