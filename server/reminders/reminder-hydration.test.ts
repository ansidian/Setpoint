import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReminder, markReminderSent } from "./reminder-service.ts";
import {
  hydrateCalendarEventsWithReminderState,
  hydrateTodoistTasksWithReminderState,
} from "./reminder-hydration.ts";

// These tests drive hydration through the REAL reminder service against an
// in-memory libsql db. The product rule under test (reminder-hydration.ts:19-37)
// is the source-identity mapping: a recurring calendar event keys its reminder
// state by its occurrence (originalStartTime), a non-recurring event keys by null.
// We assert that rule via the RETURNED item shape — the seeded reminder state only
// attaches when the source key was computed correctly, so the returned item is a
// faithful end-to-end signal without coupling to the internal collaborator's args.
describe("reminder hydration module", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(`
      CREATE TABLE ea_reminders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
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
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  });

  afterEach(async () => {
    await db?.close?.();
  });

  it("hydrates a recurring calendar event using its occurrence identity (originalStartTime)", async () => {
    // Seed a future pending reminder keyed by the recurring occurrence id.
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      sourceOccurrenceId: "2026-05-05T15:00:00.000Z",
      anchorKind: "event_start",
      anchorAt: "2026-05-05T15:00:00.000Z",
      offsetMinutes: -15,
    }, { dbClient: db, idFactory: () => "occ-reminder" });

    const events = await hydrateCalendarEventsWithReminderState("u1", [
      {
        id: "event-1",
        isRecurring: true,
        originalStartTime: "2026-05-05T15:00:00.000Z",
        startMs: Date.parse("2026-05-05T15:00:00.000Z"),
      },
    ], { dbClient: db, now: "2026-05-05T14:00:00.000Z" });

    // The state attaches only because the source key used originalStartTime as the
    // occurrence id; the spread populates the flattened item fields too.
    expect(events[0]).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-05-05T14:45:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-05-05T14:45:00.000Z",
      },
    });
  });

  it("does not attach a recurring occurrence's reminder to a non-recurring event (occurrence id is null)", async () => {
    // A reminder exists for the SAME item id but bound to an occurrence id.
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      sourceOccurrenceId: "2026-05-05T15:00:00.000Z",
      anchorKind: "event_start",
      anchorAt: "2026-05-05T15:00:00.000Z",
      offsetMinutes: -15,
    }, { dbClient: db, idFactory: () => "occ-reminder" });

    // A non-recurring event keys by occurrence id null, so it must NOT pick up the
    // occurrence-scoped reminder above.
    const events = await hydrateCalendarEventsWithReminderState("u1", [
      {
        id: "event-1",
        isRecurring: false,
        originalStartTime: "2026-05-05T15:00:00.000Z",
        startMs: Date.parse("2026-05-05T15:00:00.000Z"),
      },
    ], { dbClient: db, now: "2026-05-05T14:00:00.000Z" });

    expect(events[0]).toMatchObject({
      hasUpcomingReminder: false,
      upcomingReminderCount: 0,
      nextReminderAt: null,
      reminderState: {
        hasUpcomingReminder: false,
        upcomingCount: 0,
        nextReminderAt: null,
      },
    });
  });

  it("hydrates Todoist tasks and supplies the empty reminder state when no row exists", async () => {
    const tasks = await hydrateTodoistTasksWithReminderState("u1", [{ id: 123 }], {
      dbClient: db,
      now: "2026-05-05T14:00:00.000Z",
    });

    expect(tasks[0]).toMatchObject({
      reminderState: {
        hasUpcomingReminder: false,
        upcomingCount: 0,
        nextReminderAt: null,
      },
      hasUpcomingReminder: false,
      upcomingReminderCount: 0,
      nextReminderAt: null,
    });
  });

  it("hydrates a Todoist task (occurrence id null) with its future pending reminder state", async () => {
    // The numeric task id must match against the stringified source item id.
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "123",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-05T15:00:00.000Z",
      offsetMinutes: -10,
    }, { dbClient: db, idFactory: () => "task-reminder" });
    // A sent reminder for the same task must be ignored (only future pending count).
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "123",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-05T15:00:00.000Z",
      offsetMinutes: -20,
    }, { dbClient: db, idFactory: () => "task-sent" });
    await markReminderSent("task-sent", { sentAt: "2026-05-05T14:30:00.000Z" }, { dbClient: db });

    const tasks = await hydrateTodoistTasksWithReminderState("u1", [{ id: 123 }], {
      dbClient: db,
      now: "2026-05-05T14:00:00.000Z",
    });

    expect(tasks[0]).toMatchObject({
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-05-05T14:50:00.000Z",
      },
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-05-05T14:50:00.000Z",
    });
  });
});
