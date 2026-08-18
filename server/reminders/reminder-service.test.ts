import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReminderSourceIdentity } from "../../shared/types/reminders.ts";
import { GoogleRoutesError } from "../platform/google-routes.ts";
import {
  createReminder,
  deleteReminder,
  deleteSourceReminders,
  getReminderById,
  listDueReminders,
  listUpcomingReminderStatesForSources,
  listRemindersForSource,
  markReminderDeliveryFailed,
  markReminderMissed,
  markReminderSent,
  recomputeUnsentRemindersForSource,
} from "./reminder-service.ts";

describe("reminder service", () => {
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
    `);
  });

  afterEach(async () => {
    await db?.close?.();
  });

  it("creates, lists, recomputes, and deletes reminders for a polymorphic source", async () => {
    const reminder = await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-1",
      sourceOccurrenceId: "2026-05-10T17:00:00.000Z",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -30,
      payloadSnapshot: { title: "Dentist", url: "https://calendar.example/event-1" },
    }, { dbClient: db, idFactory: () => "reminder-1" });

    expect(reminder).toMatchObject({
      id: "reminder-1",
      reminder_kind: "fixed",
      user_id: "u1",
      source_type: "calendar_event",
      source_item_id: "event-1",
      remind_at: "2026-05-10T16:30:00.000Z",
      status: "pending",
    });

    await recomputeUnsentRemindersForSource({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      anchorAt: "2026-05-10T18:00:00.000Z",
      anchorKind: "event_start",
    }, { dbClient: db, now: "2026-05-10T16:00:00.000Z" });

    expect(await listRemindersForSource({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
    }, { dbClient: db })).toMatchObject([
      { id: "reminder-1", remind_at: "2026-05-10T17:30:00.000Z" },
    ]);

    expect(await deleteReminder("u1", "reminder-1", { dbClient: db })).toBe(true);
    expect(await listRemindersForSource({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
    }, { dbClient: db })).toEqual([]);
  });

  it("creates and round-trips one occurrence-scoped Time to Leave reminder after a successful route", async () => {
    await db.execute({
      sql: `INSERT INTO ea_settings
              (user_id, home_location_address, home_location_place_id,
               home_location_lat, home_location_lng)
            VALUES (?, ?, ?, ?, ?)`,
      args: ["u1", "1 Home Way", "home-place", 47.61, -122.33],
    });
    const routeInputs: unknown[] = [];

    const reminder = await createReminder({
      userId: "u1",
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-ttl",
      sourceOccurrenceId: "2026-08-18T20:00:00.000Z",
      isRecurring: true,
      eventStart: "2026-08-18T20:00:00.000Z",
      eventLocation: "  500 Pine St, Seattle, WA  ",
      arrivalBufferMinutes: 15,
      payloadSnapshot: { title: "Appointment" },
    }, {
      dbClient: db,
      idFactory: () => "ttl-1",
      now: "2026-08-18T16:00:00.000Z",
      computeRoute: async (input) => {
        routeInputs.push(input);
        return { durationSeconds: 1_800, distanceMeters: 12_345 };
      },
    });

    expect(routeInputs).toEqual([{
      origin: { lat: 47.61, lng: -122.33 },
      destination: "500 Pine St, Seattle, WA",
    }]);
    expect(reminder).toMatchObject({
      id: "ttl-1",
      reminder_kind: "time_to_leave",
      source_type: "calendar_event",
      source_occurrence_id: "2026-08-18T20:00:00.000Z",
      anchor_kind: "event_start",
      anchor_at: "2026-08-18T20:00:00.000Z",
      offset_minutes: 0,
      arrival_buffer_minutes: 15,
      route_duration_seconds: 1_800,
      route_distance_meters: 12_345,
      route_checked_at: "2026-08-18T16:00:00.000Z",
      next_route_check_at: "2026-08-18T16:15:00.000Z",
      route_status: "ready",
      route_error_code: null,
      remind_at: "2026-08-18T19:15:00.000Z",
      payload_snapshot: {
        title: "Appointment",
        location: "500 Pine St, Seattle, WA",
      },
    });

    expect(await deleteReminder("u1", "ttl-1", { dbClient: db })).toBe(true);
  });

  it("admits an already-due dynamic reminder to delivery after the refresh gate", async () => {
    await db.execute({
      sql: `INSERT INTO ea_settings
              (user_id, home_location_address, home_location_place_id,
               home_location_lat, home_location_lng)
            VALUES ('u1', '1 Home Way', 'home-place', 47.61, -122.33)`,
      args: [],
    });
    await createReminder({
      userId: "u1",
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-due",
      eventStart: "2026-08-18T17:00:00.000Z",
      eventLocation: "500 Pine St",
      arrivalBufferMinutes: 15,
    }, {
      dbClient: db,
      idFactory: () => "ttl-due",
      now: "2026-08-18T16:30:00.000Z",
      computeRoute: async () => ({ durationSeconds: 1_800, distanceMeters: 10_000 }),
    });

    expect((await getReminderById("ttl-due", { dbClient: db }))?.remind_at)
      .toBe("2026-08-18T16:15:00.000Z");
    expect(await listDueReminders({
      now: "2026-08-18T16:30:00.000Z",
    }, { dbClient: db })).toHaveLength(1);
  });

  it("rejects missing Home and provider failures before persisting dynamic rows", async () => {
    const input = {
      userId: "u1",
      reminderKind: "time_to_leave" as const,
      sourceType: "calendar_event" as const,
      sourceAccountId: "gmail-1",
      sourceCalendarId: "primary",
      sourceItemId: "event-fail",
      eventStart: "2026-08-18T20:00:00.000Z",
      eventLocation: "500 Pine St",
    };

    await expect(createReminder(input, {
      dbClient: db,
      now: "2026-08-18T16:00:00.000Z",
      computeRoute: async () => ({ durationSeconds: 600, distanceMeters: 1_000 }),
    })).rejects.toMatchObject({ code: "time_to_leave_home_not_configured" });

    await db.execute({
      sql: `INSERT INTO ea_settings
              (user_id, home_location_address, home_location_place_id,
               home_location_lat, home_location_lng)
            VALUES ('u1', '1 Home Way', 'home-place', 47.61, -122.33)`,
      args: [],
    });
    await expect(createReminder(input, {
      dbClient: db,
      now: "2026-08-18T16:00:00.000Z",
      computeRoute: async () => {
        throw new GoogleRoutesError("no_route", "No route", 400);
      },
    })).rejects.toMatchObject({ code: "time_to_leave_no_route", status: 400 });

    expect((await db.execute("SELECT COUNT(*) AS count FROM ea_reminders")).rows[0]?.count).toBe(0);
  });

  it("returns recompute mutations without executing them in collect mode (P2-21)", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-collect",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -30,
    }, { dbClient: db, idFactory: () => "collect-1" });

    const statements = await recomputeUnsentRemindersForSource({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-collect",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T18:00:00.000Z",
    }, { dbClient: db, now: "2026-05-10T16:00:00.000Z", collect: true });

    // Collect mode returns the mutation as data and does NOT touch the DB...
    expect(Array.isArray(statements)).toBe(true);
    expect(statements).toHaveLength(1);
    const before = await listRemindersForSource({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-collect",
    }, { dbClient: db });
    expect(before[0]!.remind_at).toBe("2026-05-10T16:30:00.000Z");

    // ...and the returned statements apply the recompute when batched.
    await db.batch(statements);
    const after = await listRemindersForSource({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-collect",
    }, { dbClient: db });
    expect(after[0]!.remind_at).toBe("2026-05-10T17:30:00.000Z");
  });

  it("cancels pending reminders that become untriggerable after an anchor moves into the past", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: 0,
    }, { dbClient: db, idFactory: () => "at-start" });
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: 60,
    }, { dbClient: db, idFactory: () => "after-start" });

    await recomputeUnsentRemindersForSource({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T15:00:00.000Z",
    }, {
      dbClient: db,
      now: "2026-05-10T15:30:00.000Z",
    });

    expect(await listRemindersForSource({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
    }, { dbClient: db })).toMatchObject([
      {
        id: "after-start",
        anchor_at: "2026-05-10T15:00:00.000Z",
        remind_at: "2026-05-10T16:00:00.000Z",
        status: "pending",
      },
    ]);
  });

  it("keeps sent rows for audit while source cleanup can remove all rows", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-1",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -10,
    }, { dbClient: db, idFactory: () => "sent-1" });
    await markReminderSent("sent-1", { sentAt: "2026-05-10T16:50:01.000Z" }, { dbClient: db });

    expect(await listRemindersForSource({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-1",
    }, { dbClient: db })).toMatchObject([{ status: "sent" }]);

    expect(await deleteSourceReminders({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-1",
    }, { dbClient: db })).toBe(1);
  });

  it("selects due unsent rows, updates retry metadata, and marks missed rows", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "due",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T16:00:00.000Z",
      offsetMinutes: -5,
    }, { dbClient: db, idFactory: () => "due-1" });
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "future",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T18:00:00.000Z",
      offsetMinutes: 0,
    }, { dbClient: db, idFactory: () => "future-1" });

    expect(await listDueReminders({
      now: "2026-05-10T16:00:00.000Z",
    }, { dbClient: db })).toMatchObject([{ id: "due-1" }]);

    await markReminderDeliveryFailed("due-1", {
      error: "429 Too Many Requests",
      retryAfter: "2026-05-10T16:02:00.000Z",
    }, { dbClient: db });
    expect((await listRemindersForSource({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "due",
    }, { dbClient: db }))[0]).toMatchObject({
      retry_count: 1,
      retry_after: "2026-05-10T16:02:00.000Z",
      last_error: "429 Too Many Requests",
    });

    await markReminderMissed("future-1", { missedAt: "2026-05-11T01:00:00.000Z" }, { dbClient: db });
    expect((await listRemindersForSource({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "future",
    }, { dbClient: db }))[0]).toMatchObject({ status: "missed" });
  });

  it("claims sending atomically so a duplicate processor cannot re-send an already-sent reminder", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "due",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T16:00:00.000Z",
      offsetMinutes: -5,
    }, { dbClient: db, idFactory: () => "claim-1" });

    // First processor wins the claim.
    const firstClaim = await markReminderSent("claim-1", {
      sentAt: "2026-05-10T15:55:00.000Z",
    }, { dbClient: db });
    expect(firstClaim).toBe(true);

    // A stale/duplicate processor re-marking the same row affects 0 rows: the
    // status='pending' guard rejects it and the original sent_at is preserved.
    const secondClaim = await markReminderSent("claim-1", {
      sentAt: "2026-05-10T16:30:00.000Z",
    }, { dbClient: db });
    expect(secondClaim).toBe(false);

    const [row] = await listRemindersForSource({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "due",
    }, { dbClient: db });
    expect(row).toMatchObject({
      status: "sent",
      sent_at: "2026-05-10T15:55:00.000Z",
    });
  });

  it("projects upcoming reminder state for source keys only from future pending reminders", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      sourceOccurrenceId: "2026-05-10T17:00:00.000Z",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -30,
    }, { dbClient: db, idFactory: () => "event-future" });
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      sourceOccurrenceId: "other-occurrence",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -20,
    }, { dbClient: db, idFactory: () => "event-other" });
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-1",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -10,
    }, { dbClient: db, idFactory: () => "task-sent" });
    await markReminderSent("task-sent", { sentAt: "2026-05-10T16:50:01.000Z" }, { dbClient: db });

    const states = await listUpcomingReminderStatesForSources({
      userId: "u1",
      sources: [
        {
          sourceType: "calendar_event",
          sourceItemId: "event-1",
          sourceOccurrenceId: "2026-05-10T17:00:00.000Z",
        },
        {
          sourceType: "todoist_task",
          sourceItemId: "task-1",
          sourceOccurrenceId: null,
        },
      ],
      now: "2026-05-10T16:00:00.000Z",
    }, { dbClient: db });

    expect(states.get("calendar_event:event-1:2026-05-10T17:00:00.000Z")).toEqual({
      hasUpcomingReminder: true,
      upcomingCount: 1,
      nextReminderAt: "2026-05-10T16:30:00.000Z",
    });
    expect(states.get("todoist_task:task-1:")).toEqual({
      hasUpcomingReminder: false,
      upcomingCount: 0,
      nextReminderAt: null,
    });
  });

  it("batches large source lists so calendar ranges do not exceed SQLite expression depth", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1099",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -15,
    }, { dbClient: db, idFactory: () => "large-range-reminder" });

    const sources: ReminderSourceIdentity[] = Array.from({ length: 1100 }, (_, index) => ({
      sourceType: "calendar_event",
      sourceItemId: `event-${index}`,
      sourceOccurrenceId: null,
    }));
    const states = await listUpcomingReminderStatesForSources({
      userId: "u1",
      sources,
      now: "2026-05-10T16:00:00.000Z",
    }, { dbClient: db });

    expect(states).toHaveLength(1100);
    expect(states.get("calendar_event:event-1099:")).toEqual({
      hasUpcomingReminder: true,
      upcomingCount: 1,
      nextReminderAt: "2026-05-10T16:45:00.000Z",
    });
  });
});
