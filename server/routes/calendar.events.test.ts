import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { seedOwner, seedSession } from "../test-utils/auth-db.ts";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

const calendarProvider = vi.hoisted(() => ({
  getAuthorizedAccount: vi.fn(),
  googleCalendarFetch: vi.fn(),
  listCalendarsForAccount: vi.fn(),
}));

const placesProvider = vi.hoisted(() => ({
  suggestGooglePlaces: vi.fn(),
  getGooglePlaceDetails: vi.fn(),
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while real route, calendar mutation, mirror, and reminder modules execute together.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
    batch: (
      statements: Parameters<Client["batch"]>[0],
      mode?: TransactionMode,
    ) => currentDb().batch(statements, mode),
    transaction: (mode?: TransactionMode) => currentDb().transaction(mode),
  },
}));

// test-architecture: allow-boundary-mock -- Google Calendar is the outbound provider boundary for real mutation and normalization behavior.
vi.mock("../calendar/calendar-google-client.ts", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getAuthorizedAccount: (...args: unknown[]) => calendarProvider.getAuthorizedAccount(...args),
    googleCalendarFetch: (...args: unknown[]) => calendarProvider.googleCalendarFetch(...args),
    listCalendarsForAccount: (...args: unknown[]) => calendarProvider.listCalendarsForAccount(...args),
  };
});

// test-architecture: allow-boundary-mock -- Google Places is the external location provider boundary for route HTTP behavior.
vi.mock("../platform/google-places.ts", () => placesProvider);

process.env.EA_USER_ID = "user-1";
process.env.NODE_ENV = "test";

const calendarRoutes = (await import("./calendar.ts")).default;
const calendarSearchMirror = await import("../calendar/calendar-search-mirror.ts");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/calendar", calendarRoutes);
  return app;
}

function authCookie() {
  return ["ea_session=cookie-session"];
}

function responseJson(value: unknown) {
  return { json: async () => value };
}

function rawEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: "calendar#event",
    id: "event-1",
    etag: '"etag-1"',
    status: "confirmed",
    summary: "Planning",
    start: { dateTime: "2026-04-20T09:00:00-07:00", timeZone: "America/Los_Angeles" },
    end: { dateTime: "2026-04-20T09:30:00-07:00", timeZone: "America/Los_Angeles" },
    ...overrides,
  };
}

const writableCalendar = {
  id: "primary",
  summary: "Personal",
  backgroundColor: "#4285f4",
  writable: true,
  accessRole: "owner",
};

describe("calendar event routes", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    await seedOwner(currentDb(), { passwordHash: "test-password-hash" });
    await seedSession(currentDb());
    await currentDb().execute({
      sql: "INSERT INTO ea_settings (user_id, weather_lat, weather_lng) VALUES (?, ?, ?)",
      args: ["user-1", 34.0522, -118.2437],
    });
    await currentDb().execute({
      sql: `INSERT INTO ea_accounts
              (id, user_id, type, email, label, calendar_enabled, credentials_encrypted)
            VALUES (?, ?, 'gmail', ?, ?, 1, NULL)`,
      args: ["gmail-main", "user-1", "me@example.com", "Google"],
    });

    calendarProvider.getAuthorizedAccount.mockReset().mockImplementation(async (account) => ({
      account,
      accessToken: "access-token",
      credentials: { access_token: "access-token", scopes: ["https://www.googleapis.com/auth/calendar.events"] },
      hasWriteScope: true,
    }));
    calendarProvider.listCalendarsForAccount.mockReset().mockResolvedValue([writableCalendar]);
    calendarProvider.googleCalendarFetch.mockReset().mockImplementation(async (
      _auth,
      path: string,
      options: { method?: string; body?: Record<string, unknown> } = {},
    ) => {
      const method = options.method || "GET";
      if (method === "GET") {
        return responseJson(rawEvent({
          id: path.includes("series-1") ? "series-1" : "event-1",
          summary: path.includes("series-1") ? "Weekly sync" : "Planning",
          ...(path.includes("event-1") && providerState.recurring ? {
            recurringEventId: "series-1",
            originalStartTime: { dateTime: "2026-04-20T09:00:00-07:00" },
          } : {}),
          ...(providerState.recurring && path.includes("series-1") ? {
            recurrence: ["RRULE:FREQ=WEEKLY"],
          } : {}),
        }));
      }
      if (method === "DELETE") return responseJson({});
      const body = options.body || {};
      return responseJson(rawEvent({
        summary: typeof body.summary === "string" ? body.summary : providerState.recurring ? "Weekly sync" : "Planning",
        ...(providerState.recurring ? {
          recurringEventId: "series-1",
          originalStartTime: { dateTime: "2026-04-20T09:00:00-07:00" },
        } : {}),
        ...(Array.isArray(body.recurrence) ? { recurrence: body.recurrence } : {}),
      }));
    });
    placesProvider.suggestGooglePlaces.mockReset();
    placesProvider.getGooglePlaceDetails.mockReset();
    providerState.recurring = false;
  });

  afterEach(async () => {
    calendarSearchMirror.stopCalendarSearchMirrorSyncWorker();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await testState.db.current?.close?.();
    testState.db.current = null;
    vi.clearAllMocks();
  });

  it("lists writable calendar sources through the real route and calendar service", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/calendars")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([
      expect.objectContaining({
        accountId: "gmail-main",
        accountEmail: "me@example.com",
        calendars: [expect.objectContaining({ id: "primary", writable: true })],
      }),
    ]);
  });

  it("creates an event and persists the write-through mirror row", async () => {
    const res = await request(makeApp())
      .post("/api/calendar/events")
      .set("Cookie", authCookie())
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Planning",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "09:00",
        endTime: "09:30",
        colorId: "7",
      });

    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      id: "event-1",
      title: "Planning",
      accountId: "gmail-main",
      calendarId: "primary",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const mirror = await currentDb().execute({
      sql: "SELECT event_id, account_id, calendar_id, title FROM ea_calendar_search_occurrences WHERE user_id = ?",
      args: ["user-1"],
    });
    expect(mirror.rows).toEqual([
      expect.objectContaining({ event_id: "event-1", account_id: "gmail-main", calendar_id: "primary", title: "Planning" }),
    ]);
  });

  it("creates a batch and reports real per-item validation failures", async () => {
    const res = await request(makeApp())
      .post("/api/calendar/events/batch")
      .set("Cookie", authCookie())
      .send({
        items: [
          {
            accountId: "gmail-main",
            calendarId: "primary",
            title: "Tue shift",
            allDay: false,
            startDate: "2026-04-21",
            endDate: "2026-04-21",
            startTime: "04:15",
            endTime: "07:30",
          },
          {
            accountId: "gmail-main",
            calendarId: "primary",
            title: "",
            allDay: false,
            startDate: "2026-04-22",
            endDate: "2026-04-22",
            startTime: "04:15",
            endTime: "07:30",
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.failed).toEqual([
      expect.objectContaining({ index: 1, code: "calendar_validation_error" }),
    ]);
  });

  it("creates batch items with a bounded four-request provider fan-out", async () => {
    let activeCreates = 0;
    let maxActiveCreates = 0;
    calendarProvider.googleCalendarFetch.mockImplementation(async (
      _auth,
      _path: string,
      options: { method?: string; body?: Record<string, unknown> } = {},
    ) => {
      activeCreates += 1;
      maxActiveCreates = Math.max(maxActiveCreates, activeCreates);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeCreates -= 1;
      return responseJson(rawEvent({
        id: String(options.body?.id || `event-${maxActiveCreates}`),
        summary: String(options.body?.summary || "Planning"),
      }));
    });
    const items = Array.from({ length: 8 }, (_, index) => ({
      accountId: "gmail-main",
      calendarId: "primary",
      clientEventId: `0000000000000000000000000000000${index}`,
      title: `Batch ${index}`,
      allDay: false,
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      startTime: "09:00",
      endTime: "09:30",
    }));

    const res = await request(makeApp())
      .post("/api/calendar/events/batch")
      .set("Cookie", authCookie())
      .send({ items });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(8);
    expect(maxActiveCreates).toBe(4);
  });

  it("returns the current provider event for timeout verification", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/events/event-1?accountId=gmail-main&calendarId=primary")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      id: "event-1",
      title: "Planning",
      accountId: "gmail-main",
      calendarId: "primary",
    });
  });

  it("rejects moving an event across connected accounts at the HTTP boundary", async () => {
    const res = await request(makeApp())
      .patch("/api/calendar/events/event-1")
      .set("Cookie", authCookie())
      .send({
        accountId: "gmail-main",
        sourceAccountId: "gmail-alt",
        calendarId: "primary",
        sourceCalendarId: "primary",
        title: "Updated",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-21",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "calendar_cross_account_move_unsupported",
      message: "Move events between calendars on the same Google account.",
    });
  });

  it("updates one recurring occurrence through the real mutation service", async () => {
    providerState.recurring = true;
    const res = await request(makeApp())
      .patch("/api/calendar/events/event-1")
      .set("Cookie", authCookie())
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Weekly sync",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "10:00",
        endTime: "10:30",
        scope: "one",
        recurringEventId: "series-1",
        originalStartTime: "2026-04-20T09:00:00-07:00",
      });

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      id: "event-1",
      title: "Weekly sync",
      isRecurring: true,
      recurringEventId: "series-1",
    });
  });

  it("deletes an event and removes its pending durable reminder", async () => {
    await currentDb().execute({
      sql: `INSERT INTO ea_reminders
              (id, user_id, source_type, source_item_id, anchor_kind, anchor_at, offset_minutes, remind_at)
            VALUES (?, ?, 'calendar_event', ?, 'event_start', ?, ?, ?)`,
      args: [
        "reminder-1",
        "user-1",
        "event-1",
        "2026-04-20T16:00:00.000Z",
        -15,
        "2026-04-20T15:45:00.000Z",
      ],
    });

    const res = await request(makeApp())
      .delete("/api/calendar/events/event-1")
      .set("Cookie", authCookie())
      .send({ accountId: "gmail-main", calendarId: "primary", etag: '"etag-1"' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const reminders = await currentDb().execute({
      sql: "SELECT id FROM ea_reminders WHERE user_id = ? AND source_item_id = ?",
      args: ["user-1", "event-1"],
    });
    expect(reminders.rows).toEqual([]);
  });

  it("keeps the successful delete response when reminder cleanup has a database failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = currentDb();
    const execute = db.execute.bind(db);
    db.execute = (async (statement: InStatement) => {
      const sql = typeof statement === "string"
        ? statement
        : "sql" in statement && typeof statement.sql === "string" ? statement.sql : "";
      if (sql.includes("DELETE FROM ea_reminders")) {
        throw new Error("reminder store down");
      }
      return execute(statement);
    }) as Client["execute"];

    const res = await request(makeApp())
      .delete("/api/calendar/events/event-1")
      .set("Cookie", authCookie())
      .send({ accountId: "gmail-main", calendarId: "primary", etag: '"etag-1"' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    consoleError.mockRestore();
  });

  it("surfaces a typed provider error from the real mutation boundary", async () => {
    calendarProvider.googleCalendarFetch.mockRejectedValueOnce({
      status: 403,
      code: "calendar_reauth_required",
      message: "Reconnect this Gmail account to edit calendar events.",
    });

    const res = await request(makeApp())
      .post("/api/calendar/events")
      .set("Cookie", authCookie())
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Planning",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      code: "calendar_reauth_required",
      message: "Reconnect this Gmail account to edit calendar events.",
    });
  });

  it("handles place search, selection, and the missing-query HTTP contract", async () => {
    placesProvider.suggestGooglePlaces.mockResolvedValueOnce([{
      placeId: "place-1",
      primaryText: "McDonald's",
      secondaryText: "Los Angeles, CA",
      fullText: "McDonald's Los Angeles, CA",
    }]);
    placesProvider.getGooglePlaceDetails.mockResolvedValueOnce({
      placeId: "place-1",
      displayName: "McDonald's",
      formattedAddress: "123 Main St, Los Angeles, CA 90012, USA",
      location: "McDonald's, 123 Main St, Los Angeles, CA 90012, USA",
      lat: 34.05,
      lng: -118.24,
    });

    const suggestions = await request(makeApp())
      .get("/api/calendar/places/suggest")
      .set("Cookie", authCookie())
      .query({ q: "McDonald's", sessionToken: "session-1" });
    const details = await request(makeApp())
      .get("/api/calendar/places/place-1")
      .set("Cookie", authCookie())
      .query({ sessionToken: "session-1" });
    const missingQuery = await request(makeApp())
      .get("/api/calendar/places/suggest")
      .set("Cookie", authCookie())
      .query({ sessionToken: "session-1" });

    expect(suggestions.status).toBe(200);
    expect(suggestions.body.places).toHaveLength(1);
    expect(details.status).toBe(200);
    expect(details.body.place.location).toContain("123 Main St");
    expect(missingQuery.status).toBe(400);
    expect(missingQuery.body).toEqual({
      code: "calendar_places_query_required",
      message: "q parameter required",
    });
  });
});

const providerState: { recurring: boolean } = { recurring: false };
