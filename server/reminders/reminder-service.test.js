import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReminder,
  deleteReminder,
  deleteSourceReminders,
  listDueReminders,
  listUpcomingReminderStatesForSources,
  listRemindersForSource,
  markReminderDeliveryFailed,
  markReminderMissed,
  markReminderSent,
  recomputeUnsentRemindersForSource,
} from "./reminder-service.js";

describe("reminder service", () => {
  let db;

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

    const sources = Array.from({ length: 1100 }, (_, index) => ({
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

  it("keeps reminder source batches below the prod libSQL expression-depth ceiling", async () => {
    const executeCalls = [];
    const dbClient = {
      execute: vi.fn(async (statement) => {
        executeCalls.push(statement);
        return { rows: [] };
      }),
    };
    const sources = Array.from({ length: 101 }, (_, index) => ({
      sourceType: "calendar_event",
      sourceItemId: `event-${index}`,
      sourceOccurrenceId: null,
    }));

    await listUpcomingReminderStatesForSources({
      userId: "u1",
      sources,
      now: "2026-05-10T16:00:00.000Z",
    }, { dbClient });

    expect(executeCalls).toHaveLength(3);
    for (const call of executeCalls) {
      const sourceClauseCount = (call.sql.match(/source_type = \?/g) || []).length;
      expect(sourceClauseCount).toBeLessThanOrEqual(50);
    }
  });
});
