import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReminder } from "./reminder-service.ts";
import {
  clearCurrentDashboardEventSubscribers,
  subscribeCurrentDashboardEvents,
} from "../dashboard/current-events.ts";
import { processDueReminderBatch } from "./reminder-scheduler.ts";

describe("reminder scheduler", () => {
  let db: Client;

  beforeEach(async () => {
    clearCurrentDashboardEventSubscribers();
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
    clearCurrentDashboardEventSubscribers();
    await db?.close?.();
  });

  it("sends due reminders inside grace and marks old reminders missed", async () => {
    const dashboardEvents: unknown[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("u1", (event: unknown) => {
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
    // test-architecture: allow-boundary-interaction -- Discord delivery is the outbound notification boundary; exactly one request distinguishes the due reminder from the durably missed one.
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

  it("isolates a thrown delivery error so the rest of the batch still fires (P1-10)", async () => {
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-fail",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T16:00:00.000Z",
      offsetMinutes: -10,
      payloadSnapshot: { title: "Fails to send" },
    }, { dbClient: db, idFactory: () => "r-fail" });
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-ok",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T16:01:00.000Z",
      offsetMinutes: -10,
      payloadSnapshot: { title: "Should still fire" },
    }, { dbClient: db, idFactory: () => "r-ok" });

    // The first reminder processed throws (e.g. network reject or corrupt
    // webhook decrypt); the second must still be delivered.
    let calls = 0;
    const send = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return { ok: true, status: 204 };
    });

    const result = await processDueReminderBatch({
      now: "2026-05-10T16:00:00.000Z",
      dbClient: db,
      decryptFn: () => "https://discord.example/webhook",
      sendFn: send,
    });

    expect(result).toEqual({ processed: 2, sent: 1, missed: 0, failed: 1 });

    const rows = await db.execute(
      "SELECT id, status, retry_count, retry_after, last_error FROM ea_reminders ORDER BY id",
    );
    expect(rows.rows.map((row) => row.status).sort()).toEqual(["pending", "sent"]);

    const failed = rows.rows.find((row) => row.status === "pending");
    if (!failed) throw new Error("Expected a pending failed reminder");
    expect(failed.retry_count).toBe(1);
    // Non-null FUTURE retry_after is load-bearing: without it, listDueReminders
    // re-selects the same head-of-line reminder every 10s and blocks all others.
    expect(failed.retry_after).toBeTruthy();
    expect(new Date(String(failed.retry_after)).getTime()).toBeGreaterThan(
      new Date("2026-05-10T16:00:00.000Z").getTime(),
    );
    expect(failed.last_error).toContain("network down");
  });

  it("does not abort the batch when recording a delivery failure itself throws (P1-10)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-a",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T16:00:00.000Z",
      offsetMinutes: -10,
      payloadSnapshot: { title: "A" },
    }, { dbClient: db, idFactory: () => "r-a" });
    await createReminder({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "task-b",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-10T16:01:00.000Z",
      offsetMinutes: -10,
      payloadSnapshot: { title: "B" },
    }, { dbClient: db, idFactory: () => "r-b" });

    // Simulate the DB being the failing component: the per-reminder failure
    // write (UPDATE ea_reminders) throws, while reads still work. Without a guard
    // around the catch-block write, this re-aborts the whole batch.
    const realExecute = db.execute.bind(db);
    db.execute = vi.fn((arg) => {
      const sql = typeof arg === "string" ? arg : arg.sql;
      if (/UPDATE\s+ea_reminders/i.test(sql)) throw new Error("db write down");
      return realExecute(arg);
    });

    const result = await processDueReminderBatch({
      now: "2026-05-10T16:00:00.000Z",
      dbClient: db,
      decryptFn: () => {
        throw new Error("bad key");
      },
      sendFn: vi.fn(),
    });

    // Both reminders are processed (counted failed); the batch does not reject
    // and is not head-of-line-blocked by the failing status write.
    expect(result).toEqual({ processed: 2, sent: 0, missed: 0, failed: 2 });
  });

  it("sets a backoff retry_after even when the failure is not rate-limited (P2-27)", async () => {
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
      // 404 (deleted webhook): not rate-limited, no Retry-After header.
      sendFn: vi.fn(async () => ({ ok: false, status: 404, rateLimited: false, retryAfterMs: null, error: "Discord 404" })),
    });

    expect(result).toMatchObject({ failed: 1 });
    const rows = await db.execute("SELECT retry_count, retry_after, status FROM ea_reminders");
    // Backoff must be set (1 min from now), not NULL — otherwise it re-fires every 10s.
    expect(rows.rows[0]!.retry_after).toBe("2026-05-10T16:01:00.000Z");
    expect(rows.rows[0]!.status).toBe("pending");
  });
});
