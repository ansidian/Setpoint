import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { getActiveSnapshotView } from "./snapshot-service.js";
import { wakeDueSnoozes } from "./snooze-waker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(readFileSync(join(migrationsDir, "001_ea_tables.sql"), "utf8"));
  return db;
}

describe("snooze waker", () => {
  it("reattaches woken snoozes to the active snapshot with resurfaced source metadata", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-04T17:30:00.000Z");
    const resurfacedAt = now.getTime();
    const wakeAtGmailFn = vi.fn().mockResolvedValue(undefined);

    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, email_snapshot, status)
            VALUES (?, ?, ?, ?, 'snoozed')`,
      args: ["user-1", "gmail-work-msg-1", resurfacedAt - 1_000, JSON.stringify({
        uid: "gmail-work-msg-1",
        id: "gmail-work-msg-1",
        account_id: "gmail-work",
        account_label: "Work Gmail",
        account_email: "work@example.test",
        account_color: "#cba6da",
        account_icon: "Mail",
        subject: "Wake this thread",
        from_name: "Casey",
        from_address: "casey@example.test",
        date: "2026-05-02T15:00:00.000Z",
        summary: "Follow up on the woken thread",
        action: "Reply",
        category: "school",
        urgency: "high",
        lane: "needs_attention",
        read: false,
      })],
    });

    const result = await wakeDueSnoozes({
      userId: "user-1",
      dbClient,
      now,
      loadUserConfigFn: vi.fn(async () => ({
        accounts: [{ id: "gmail-work", email: "work@example.test", type: "gmail" }],
      })),
      wakeAtGmailFn,
    });

    expect(result).toEqual({ woke: 1 });
    expect(wakeAtGmailFn).toHaveBeenCalledWith(
      { id: "gmail-work", email: "work@example.test", type: "gmail" },
      "gmail-work-msg-1",
    );

    const snoozeRows = await dbClient.execute({
      sql: "SELECT status, resurfaced_at FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
      args: ["user-1", "gmail-work-msg-1"],
    });
    expect(snoozeRows.rows).toEqual([{ status: "resurfaced", resurfaced_at: resurfacedAt }]);

    const view = await getActiveSnapshotView("user-1", { dbClient, now });
    expect(view.lanes.needs_attention).toHaveLength(1);
    expect(view.lanes.needs_attention[0]).toMatchObject({
      uid: "gmail-work-msg-1",
      subject: "Wake this thread",
      source: "resurfaced_snooze",
      source_at: "2026-05-04T17:30:00.000Z",
      resurfaced_at: resurfacedAt,
      _resurfaced: true,
      _resurfacedAt: resurfacedAt,
    });
  });

  it("requeues woken pending snoozes as visible not-yet-triaged resurfaced rows", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-04T17:30:00.000Z");
    const resurfacedAt = now.getTime();
    const wakeAtGmailFn = vi.fn().mockResolvedValue(undefined);

    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, email_snapshot, status)
            VALUES (?, ?, ?, ?, 'snoozed')`,
      args: ["user-1", "gmail-work-pending-msg", resurfacedAt - 1_000, JSON.stringify({
        uid: "gmail-work-pending-msg",
        id: "gmail-work-pending-msg",
        account_id: "gmail-work",
        account_label: "Work Gmail",
        account_email: "work@example.test",
        subject: "Pending wake",
        from_name: "Casey",
        from_address: "casey@example.test",
        date: "2026-05-02T15:00:00.000Z",
        summary: "Classifying soon",
        action: "Review after triage",
        category: "uncategorized",
        urgency: "normal",
        lane: "needs_attention",
      })],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source)
            VALUES (?, ?, ?, 'pending', 'user_snoozed_pending')`,
      args: ["user-1", "gmail-work", "gmail-work-pending-msg"],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, scheduled_for, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', 'complete', ?, ?)`,
      args: [
        "user-1",
        "gmail-work",
        "gmail-work-pending-msg",
        "2026-05-04T17:30:00.000Z",
        "email_triage:user-1:gmail-work:gmail-work-pending-msg",
      ],
    });

    const result = await wakeDueSnoozes({
      userId: "user-1",
      dbClient,
      now,
      loadUserConfigFn: vi.fn(async () => ({
        accounts: [{ id: "gmail-work", email: "work@example.test", type: "gmail" }],
      })),
      wakeAtGmailFn,
    });

    expect(result).toEqual({ woke: 1 });
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   j.scheduled_for,
                   j.completed_at,
                   j.last_error
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            WHERE t.email_id = ?`,
      args: ["gmail-work-pending-msg"],
    });
    expect(rows.rows).toEqual([
      {
        triage_status: "pending",
        triage_source: "snooze_resurface_pending",
        job_status: "queued",
        scheduled_for: null,
        completed_at: null,
        last_error: "",
      },
    ]);

    const view = await getActiveSnapshotView("user-1", { dbClient, now });
    expect(view.lanes.needs_attention).toHaveLength(1);
    expect(view.lanes.needs_attention[0]).toMatchObject({
      uid: "gmail-work-pending-msg",
      source: "resurfaced_snooze",
      _resurfaced: true,
    });
  });

  it("restarts arrival grace when a snoozed queued row resurfaces", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-04T17:30:00.000Z");
    const resurfacedAt = now.getTime();
    const wakeAtGmailFn = vi.fn().mockResolvedValue(undefined);

    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, email_snapshot, status)
            VALUES (?, ?, ?, ?, 'snoozed')`,
      args: ["user-1", "gmail-work-arrival-msg", resurfacedAt - 1_000, JSON.stringify({
        uid: "gmail-work-arrival-msg",
        id: "gmail-work-arrival-msg",
        account_id: "gmail-work",
        account_label: "Work Gmail",
        account_email: "work@example.test",
        subject: "Queued wake",
        from_name: "Casey",
        from_address: "casey@example.test",
        date: "2026-05-02T15:00:00.000Z",
        summary: "Queued for triage.",
        action: "Waiting briefly before triage.",
        category: "uncategorized",
        urgency: "normal",
        lane: "queued",
      })],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source, decision_metadata_json)
            VALUES (?, ?, ?, 'pending', 'user_snoozed_pending', ?)`,
      args: [
        "user-1",
        "gmail-work",
        "gmail-work-arrival-msg",
        JSON.stringify({ snoozedPending: { previousTriageSource: "arrival_grace" } }),
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, scheduled_for, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', 'queued', ?, ?)`,
      args: [
        "user-1",
        "gmail-work",
        "gmail-work-arrival-msg",
        "2026-05-04T17:30:00.000Z",
        "email_triage:user-1:gmail-work:gmail-work-arrival-msg",
      ],
    });

    await wakeDueSnoozes({
      userId: "user-1",
      dbClient,
      now,
      loadUserConfigFn: vi.fn(async () => ({
        accounts: [{ id: "gmail-work", email: "work@example.test", type: "gmail" }],
      })),
      wakeAtGmailFn,
    });

    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   j.scheduled_for,
                   i.lane_at_snapshot,
                   i.source,
                   i.source_at
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            WHERE t.email_id = ?`,
      args: ["gmail-work-arrival-msg"],
    });
    expect(rows.rows).toEqual([
      {
        triage_status: "pending",
        triage_source: "arrival_grace",
        job_status: "queued",
        scheduled_for: "2026-05-04T17:33:00.000Z",
        lane_at_snapshot: "queued",
        source: "arrival_grace",
        source_at: "2026-05-04T17:33:00.000Z",
      },
    ]);
  });
});
