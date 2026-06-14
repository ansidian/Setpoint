import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReminder } from "./reminder-service.js";
import {
  __resetCurrentDashboardEventsForTests,
  subscribeCurrentDashboardEvents,
} from "../dashboard/current-events.js";
import { processDueReminderBatch } from "./reminder-scheduler.js";

describe("reminder scheduler", () => {
  let db;

  beforeEach(async () => {
    __resetCurrentDashboardEventsForTests();
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(`
      CREATE TABLE ea_settings (
        user_id TEXT PRIMARY KEY,
        discord_webhook_url_encrypted TEXT,
        discord_user_id TEXT
      );
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
    await db.execute({
      sql: "INSERT INTO ea_settings (user_id, discord_webhook_url_encrypted, discord_user_id) VALUES (?, ?, ?)",
      args: ["u1", "encrypted-webhook", "123"],
    });
  });

  afterEach(async () => {
    __resetCurrentDashboardEventsForTests();
    await db?.close?.();
  });

  it("sends due reminders inside grace and marks old reminders missed", async () => {
    const dashboardEvents = [];
    const unsubscribe = subscribeCurrentDashboardEvents("u1", (event) => {
      dashboardEvents.push(event);
    });
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T16:00:00.000Z",
      offsetMinutes: -10,
      payloadSnapshot: { title: "Due soon" },
    }, { dbClient: db, idFactory: () => "due-1" });
    await createReminder({
      userId: "u1",
      sourceType: "calendar_event",
      sourceItemId: "event-2",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T08:00:00.000Z",
      offsetMinutes: -10,
      payloadSnapshot: { title: "Too old" },
    }, { dbClient: db, idFactory: () => "old-1" });

    const send = vi.fn(async () => ({ ok: true, status: 204 }));
    const result = await processDueReminderBatch({
      now: "2026-05-10T16:00:00.000Z",
      dbClient: db,
      decryptFn: (value) => `https://discord.example/${value}`,
      sendFn: send,
    });

    expect(result).toEqual({ processed: 2, sent: 1, missed: 1, failed: 0 });
    expect(send).toHaveBeenCalledOnce();
    const rows = await db.execute("SELECT id, status, sent_at, missed_at FROM ea_reminders ORDER BY id");
    expect(rows.rows).toMatchObject([
      { id: "due-1", status: "sent", sent_at: "2026-05-10T16:00:00.000Z" },
      { id: "old-1", status: "missed", missed_at: "2026-05-10T16:00:00.000Z" },
    ]);
    unsubscribe();
    expect(dashboardEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "reminders",
        reason: "reminder_sent",
        details: expect.objectContaining({ reminderId: "due-1" }),
      }),
      expect.objectContaining({
        source: "reminders",
        reason: "reminder_missed",
        details: expect.objectContaining({ reminderId: "old-1" }),
      }),
    ]));
  });

  it("increments retry count and stores Discord rate-limit backoff", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-1",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T16:00:00.000Z",
      offsetMinutes: -1,
      payloadSnapshot: { title: "Task" },
    }, { dbClient: db, idFactory: () => "task-reminder" });

    const result = await processDueReminderBatch({
      now: "2026-05-10T16:00:00.000Z",
      dbClient: db,
      decryptFn: () => "https://discord.example/webhook",
      sendFn: vi.fn(async () => ({
        ok: false,
        status: 429,
        rateLimited: true,
        retryAfterMs: 120_000,
        error: "Discord 429",
      })),
    });

    expect(result).toEqual({ processed: 1, sent: 0, missed: 0, failed: 1 });
    const rows = await db.execute("SELECT retry_count, retry_after, status, last_error FROM ea_reminders");
    expect(rows.rows[0]).toMatchObject({
      retry_count: 1,
      retry_after: "2026-05-10T16:02:00.000Z",
      status: "pending",
      last_error: "Discord 429",
    });
  });
});
