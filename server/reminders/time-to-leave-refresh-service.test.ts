import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoogleRoutesError } from "../platform/google-routes.ts";
import {
  createReminder,
  getReminderById,
  listDueReminders,
  scheduleTimeToLeaveRefreshForUser,
} from "./reminder-service.ts";
import { processTimeToLeaveRefreshBatch } from "./time-to-leave-refresh-service.ts";

describe("Time to Leave route refresh", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(`
      CREATE TABLE ea_settings (
        user_id TEXT PRIMARY KEY,
        home_location_address TEXT,
        home_location_place_id TEXT,
        home_location_lat REAL,
        home_location_lng REAL
      );
      CREATE TABLE ea_reminders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        reminder_kind TEXT NOT NULL DEFAULT 'fixed',
        source_type TEXT NOT NULL,
        source_account_id TEXT,
        source_calendar_id TEXT,
        source_item_id TEXT NOT NULL,
        source_occurrence_id TEXT,
        anchor_kind TEXT NOT NULL,
        anchor_at TEXT NOT NULL,
        offset_minutes INTEGER NOT NULL,
        remind_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sent_at TEXT,
        missed_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        retry_after TEXT,
        last_error TEXT,
        payload_snapshot_json TEXT,
        arrival_buffer_minutes INTEGER,
        route_duration_seconds INTEGER,
        route_distance_meters INTEGER,
        route_checked_at TEXT,
        next_route_check_at TEXT,
        route_status TEXT,
        route_error_code TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE ea_calendar_search_occurrences (
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        original_start_key TEXT NOT NULL,
        title TEXT,
        location TEXT,
        start_ms INTEGER,
        all_day INTEGER,
        status TEXT,
        html_link TEXT,
        open_url TEXT,
        source_label TEXT,
        source_color TEXT,
        event_color TEXT,
        updated_at TEXT
      );
    `);
    await db.execute({
      sql: `INSERT INTO ea_settings VALUES (?, ?, ?, ?, ?)`,
      args: ["u1", "1 Home Way", "home-place", 47.61, -122.33],
    });
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedReminder({
    id = "ttl-1",
    eventStart = "2026-08-18T17:00:00.000Z",
    durationSeconds = 900,
  } = {}) {
    await db.execute({
      sql: `INSERT INTO ea_calendar_search_occurrences
              (user_id, account_id, calendar_id, event_id, original_start_key,
               title, location, start_ms, all_day, status, html_link, source_label,
               source_color, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'confirmed', ?, ?, ?, ?)`,
      args: [
        "u1",
        "gmail-1",
        "primary",
        "event-1",
        "event-1",
        "Dentist",
        "500 Pine St",
        new Date(eventStart).getTime(),
        "https://calendar.example/event-1",
        "Personal",
        "#89b4fa",
        "2026-08-18T16:00:00.000Z",
      ],
    });
    return createReminder({
      userId: "u1",
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-1",
      eventStart,
      eventLocation: "500 Pine St",
      arrivalBufferMinutes: 15,
      payloadSnapshot: { title: "Dentist" },
    }, {
      dbClient: db,
      idFactory: () => id,
      now: "2026-08-18T16:00:00.000Z",
      computeRoute: async () => ({ durationSeconds, distanceMeters: 8_000 }),
    });
  }

  it("refreshes an already-due estimate before delivery so improving traffic moves it later", async () => {
    await seedReminder();

    const result = await processTimeToLeaveRefreshBatch({
      now: "2026-08-18T16:31:00.000Z",
      dbClient: db,
      computeRoute: async () => ({ durationSeconds: 300, distanceMeters: 8_000 }),
    });

    expect(result).toMatchObject({ processed: 1, refreshed: 1, stale: 0 });
    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      remind_at: "2026-08-18T16:40:00.000Z",
      route_duration_seconds: 300,
      route_status: "ready",
      next_route_check_at: "2026-08-18T16:36:00.000Z",
    });
    expect(await listDueReminders({ now: "2026-08-18T16:31:00.000Z" }, { dbClient: db }))
      .toHaveLength(0);
  });

  it("moves departure earlier when traffic worsens and makes the row immediately deliverable", async () => {
    await seedReminder();

    await processTimeToLeaveRefreshBatch({
      now: "2026-08-18T16:31:00.000Z",
      dbClient: db,
      computeRoute: async () => ({ durationSeconds: 2_100, distanceMeters: 8_000 }),
    });

    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      remind_at: "2026-08-18T16:10:00.000Z",
      route_duration_seconds: 2_100,
    });
    expect(await listDueReminders({ now: "2026-08-18T16:31:00.000Z" }, { dbClient: db }))
      .toHaveLength(1);
  });

  it("reroutes from the current occurrence after its start and location change", async () => {
    await seedReminder();
    await db.execute({
      sql: `UPDATE ea_calendar_search_occurrences
            SET start_ms = ?, location = ?, updated_at = ?
            WHERE user_id = 'u1' AND event_id = 'event-1'`,
      args: [
        new Date("2026-08-18T18:00:00.000Z").getTime(),
        "900 Cedar Ave",
        "2026-08-18T16:30:00.000Z",
      ],
    });
    let destination = "";

    await processTimeToLeaveRefreshBatch({
      now: "2026-08-18T16:31:00.000Z",
      dbClient: db,
      computeRoute: async (input) => {
        destination = input.destination;
        return { durationSeconds: 1_800, distanceMeters: 9_000 };
      },
    });

    expect(destination).toBe("900 Cedar Ave");
    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      anchor_at: "2026-08-18T18:00:00.000Z",
      remind_at: "2026-08-18T17:15:00.000Z",
      route_duration_seconds: 1_800,
      payload_snapshot: expect.objectContaining({ location: "900 Cedar Ave" }),
    });
  });

  it("marks a cancelled current occurrence missed without calling Routes", async () => {
    await seedReminder();
    await db.execute({
      sql: `UPDATE ea_calendar_search_occurrences
            SET status = 'cancelled', updated_at = ?
            WHERE user_id = 'u1' AND event_id = 'event-1'`,
      args: ["2026-08-18T16:30:00.000Z"],
    });
    let routeCalls = 0;

    const result = await processTimeToLeaveRefreshBatch({
      now: "2026-08-18T16:31:00.000Z",
      dbClient: db,
      computeRoute: async () => {
        routeCalls += 1;
        return { durationSeconds: 1_800, distanceMeters: 9_000 };
      },
    });

    expect(result).toMatchObject({ missed: 1, refreshed: 0 });
    expect(routeCalls).toBe(0);
    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      status: "missed",
      route_status: "blocked",
      route_error_code: "time_to_leave_event_cancelled",
    });
  });

  it("retains the last estimate on provider failure with a bounded retry", async () => {
    const original = await seedReminder();

    const result = await processTimeToLeaveRefreshBatch({
      now: "2026-08-18T16:31:00.000Z",
      dbClient: db,
      computeRoute: async () => {
        throw new GoogleRoutesError("rate_limited", "secret provider text", 429);
      },
    });

    expect(result).toMatchObject({ degraded: 1 });
    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      remind_at: original.remind_at,
      route_duration_seconds: original.route_duration_seconds,
      route_status: "degraded",
      route_error_code: "time_to_leave_rate_limited",
      next_route_check_at: "2026-08-18T16:36:00.000Z",
    });
  });

  it("discards a stale provider result when Home changes during the request", async () => {
    const original = await seedReminder();

    const result = await processTimeToLeaveRefreshBatch({
      now: "2026-08-18T16:31:00.000Z",
      dbClient: db,
      computeRoute: async () => {
        await db.execute({
          sql: `UPDATE ea_settings
                SET home_location_address = '2 New Home Way', home_location_place_id = 'new-home'
                WHERE user_id = 'u1'`,
          args: [],
        });
        return { durationSeconds: 2_100, distanceMeters: 12_000 };
      },
    });

    expect(result).toMatchObject({ refreshed: 0, stale: 1 });
    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      remind_at: original.remind_at,
      route_duration_seconds: original.route_duration_seconds,
      route_checked_at: original.route_checked_at,
    });
  });

  it("blocks on Home removal and requeues when Home is restored", async () => {
    await seedReminder();
    await scheduleTimeToLeaveRefreshForUser({ userId: "u1", homeAvailable: false }, { dbClient: db });
    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      route_status: "blocked",
      route_error_code: "time_to_leave_home_not_configured",
      next_route_check_at: null,
    });

    let routeCalls = 0;
    expect(await processTimeToLeaveRefreshBatch({
      now: "2026-08-18T16:50:00.000Z",
      dbClient: db,
      computeRoute: async () => {
        routeCalls += 1;
        return { durationSeconds: 900, distanceMeters: 8_000 };
      },
    })).toMatchObject({ processed: 0 });
    expect(routeCalls).toBe(0);

    await scheduleTimeToLeaveRefreshForUser({
      userId: "u1",
      homeAvailable: true,
      now: "2026-08-18T16:45:00.000Z",
    }, { dbClient: db });
    expect(await getReminderById("ttl-1", { dbClient: db })).toMatchObject({
      route_status: "degraded",
      route_error_code: null,
      next_route_check_at: "2026-08-18T16:45:00.000Z",
    });
  });
});
