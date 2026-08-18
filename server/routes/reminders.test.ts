import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while the real reminder route, service, model, credential resolver, and persistence execute together.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement | string) => currentDb().execute(statement),
    batch: (
      statements: Parameters<Client["batch"]>[0],
      mode?: TransactionMode,
    ) => currentDb().batch(statements, mode),
    transaction: (mode?: TransactionMode) => currentDb().transaction(mode),
  },
}));

process.env.EA_USER_ID = "user-1";
process.env.EA_ENCRYPTION_KEY = "22".repeat(32);
process.env.GOOGLE_MAPS_API_KEY = "test-maps-key";

const reminderRoutes = (await import("./reminders.ts")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ea", reminderRoutes);
  return app;
}

function routeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  testState.db.current = await createMigratedDb();
  await currentDb().execute({
    sql: `INSERT INTO ea_settings
            (user_id, home_location_label, home_location_address,
             home_location_place_id, home_location_lat, home_location_lng)
          VALUES (?, 'Home', '1 Home Way', 'home-place', 47.61, -122.33)`,
    args: ["user-1"],
  });
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reminder routes", () => {
  it("creates, lists, and deletes a traffic-grounded Time to Leave reminder", async () => {
    let fetchCount = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCount += 1;
      return routeResponse({ routes: [{ duration: "1800s", distanceMeters: 12_345 }] });
    });

    const created = await request(makeApp()).post("/api/ea/reminders").send({
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-ttl",
      sourceOccurrenceId: "2099-08-18T20:00:00.000Z",
      isRecurring: true,
      eventStart: "2099-08-18T20:00:00.000Z",
      eventLocation: "500 Pine St, Seattle, WA",
      arrivalBufferMinutes: 15,
      payloadSnapshot: { title: "Appointment" },
    });

    expect(created.status).toBe(201);
    expect(created.body.reminder).toMatchObject({
      reminder_kind: "time_to_leave",
      source_occurrence_id: "2099-08-18T20:00:00.000Z",
      arrival_buffer_minutes: 15,
      route_duration_seconds: 1_800,
      route_distance_meters: 12_345,
      route_status: "ready",
    });
    expect(fetchCount).toBe(1);

    const listed = await request(makeApp()).get(
      "/api/ea/reminders?sourceType=calendar_event&sourceItemId=event-ttl&sourceOccurrenceId=2099-08-18T20%3A00%3A00.000Z",
    );
    expect(listed.body.reminders).toHaveLength(1);

    const deleted = await request(makeApp()).delete(
      `/api/ea/reminders/${encodeURIComponent(created.body.reminder.id)}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
  });

  it("rejects invalid dynamic input before provider work and returns bounded provider codes", async () => {
    let fetchCount = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCount += 1;
      return routeResponse({ routes: [] });
    });

    const invalid = await request(makeApp()).post("/api/ea/reminders").send({
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-invalid",
      eventStart: "2099-08-18T20:00:00.000Z",
      eventLocation: "https://zoom.us/j/123",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("time_to_leave_location_unsupported");
    expect(fetchCount).toBe(0);

    const noRoute = await request(makeApp()).post("/api/ea/reminders").send({
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-no-route",
      eventStart: "2099-08-18T20:00:00.000Z",
      eventLocation: "Unresolvable physical place",
    });
    expect(noRoute.status).toBe(400);
    expect(noRoute.body).toMatchObject({
      code: "time_to_leave_no_route",
      message: "No driving route was found for the event location.",
    });
    expect(fetchCount).toBe(1);
    expect(JSON.stringify(noRoute.body)).not.toContain("routes");
  });

  it("keeps the existing fixed request shape compatible and provider-free", async () => {
    let fetchCount = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCount += 1;
      return routeResponse({ routes: [] });
    });

    const created = await request(makeApp()).post("/api/ea/reminders").send({
      sourceType: "calendar_event",
      sourceItemId: "event-fixed",
      anchorKind: "event_start",
      anchorAt: "2099-08-18T20:00:00.000Z",
      offsetMinutes: -15,
    });

    expect(created.status).toBe(201);
    expect(created.body.reminder).toMatchObject({
      reminder_kind: "fixed",
      remind_at: "2099-08-18T19:45:00.000Z",
    });
    expect(fetchCount).toBe(0);
  });
});
