import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveSnapshotView } from "./snapshot-service.ts";
import { createMigratedDb, seedSnapshotItem } from "./snapshot-test-fixtures.ts";
import { startSnoozeWaker, stopSnoozeWaker, wakeDueSnoozes } from "./snooze-waker.ts";

const cronApi = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock("node-cron", () => ({ default: cronApi }));

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
        scheduled_for: "2026-05-04T17:30:30.000Z", // now + 30s arrival grace
        lane_at_snapshot: "queued",
        source: "arrival_grace",
        source_at: "2026-05-04T17:30:30.000Z",
      },
    ]);
  });

  // P3-59: overlapping cron ticks must not double-process the same due snoozes.
  it("does not double-process when a tick re-enters while one is in flight", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-04T17:30:00.000Z");
    const resurfacedAt = now.getTime();

    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, email_snapshot, status)
            VALUES (?, ?, ?, ?, 'snoozed')`,
      args: ["user-1", "gmail-work-msg-1", resurfacedAt - 1_000, JSON.stringify({
        uid: "gmail-work-msg-1",
        id: "gmail-work-msg-1",
        account_id: "gmail-work",
        account_email: "work@example.test",
        subject: "Wake this thread",
        summary: "Follow up",
        category: "school",
        urgency: "high",
        lane: "needs_attention",
      })],
    });

    // First tick hangs inside the Gmail wake-modify so the second tick overlaps it.
    let releaseFirst;
    const firstHang = new Promise((resolve) => { releaseFirst = resolve; });
    let wakeCalls = 0;
    const wakeAtGmailFn = vi.fn(async () => {
      wakeCalls += 1;
      await firstHang;
    });
    const loadUserConfigFn = vi.fn(async () => ({
      accounts: [{ id: "gmail-work", email: "work@example.test", type: "gmail" }],
    }));

    const firstTick = wakeDueSnoozes({ userId: "user-1", dbClient, now, loadUserConfigFn, wakeAtGmailFn });
    // Let the first tick reach the awaiting Gmail call before re-entering.
    await Promise.resolve();
    await Promise.resolve();
    const secondTick = await wakeDueSnoozes({ userId: "user-1", dbClient, now, loadUserConfigFn, wakeAtGmailFn });

    expect(secondTick).toEqual({ woke: 0, skipped: "in_flight" });

    releaseFirst!();
    const firstResult = await firstTick;
    expect(firstResult).toEqual({ woke: 1 });

    // The due snooze was processed exactly once: one Gmail wake-modify, one resurfaced item.
    expect(wakeCalls).toBe(1);
    const snoozeRows = await dbClient.execute({
      sql: "SELECT status FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
      args: ["user-1", "gmail-work-msg-1"],
    });
    expect(snoozeRows.rows).toEqual([{ status: "resurfaced" }]);

    const view = await getActiveSnapshotView("user-1", { dbClient, now });
    expect(view.lanes.needs_attention).toHaveLength(1);
  });

  // P3-61: a completed-triage snooze must resurface by un-hiding the live item,
  // keeping the owner's real lane/summary, not re-deriving from the snapshot JSON.
  it("resurfaces a completed-triage snooze by un-hiding the existing item without clobbering triage", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-04T17:30:00.000Z");
    const resurfacedAt = now.getTime();
    const wakeAtGmailFn = vi.fn().mockResolvedValue(undefined);

    // Live, already-triaged item the owner filed into the 'fyi' lane.
    const { triageId } = await seedSnapshotItem(dbClient, {
      userId: "user-1",
      accountId: "gmail-work",
      emailId: "gmail-work-done-msg",
      lane: "fyi",
      category: "newsletter",
      now,
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET triage_status = 'complete',
                last_triaged_at = ?,
                summary = 'Filed FYI by owner',
                urgency = 'low'
            WHERE id = ?`,
      args: ["2026-05-04T16:00:00.000Z", triageId],
    });
    // The item was hidden when it got snoozed.
    await dbClient.execute({
      sql: `UPDATE ea_briefing_snapshot_items
            SET dismissed_from_today_at = ?
            WHERE triage_id = ?`,
      args: ["2026-05-04T16:00:00.000Z", triageId],
    });

    // The snooze JSON carries a STALE lane (needs_attention) — re-deriving from it
    // would demote the real 'fyi' item. The fix must ignore this and un-hide in place.
    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, email_snapshot, status)
            VALUES (?, ?, ?, ?, 'snoozed')`,
      args: ["user-1", "gmail-work-done-msg", resurfacedAt - 1_000, JSON.stringify({
        uid: "gmail-work-done-msg",
        id: "gmail-work-done-msg",
        account_id: "gmail-work",
        account_email: "work@example.test",
        subject: "Filed thread",
        summary: "STALE summary from snapshot",
        category: "uncategorized",
        urgency: "high",
        lane: "needs_attention",
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

    // Triage fields are untouched: still complete, still 'fyi', summary preserved.
    const triageRows = await dbClient.execute({
      sql: `SELECT triage_status, triage_source, lane, urgency, summary
            FROM ea_email_triage WHERE id = ?`,
      args: [triageId],
    });
    expect(triageRows.rows).toEqual([
      {
        triage_status: "complete",
        triage_source: "unknown",
        lane: "fyi",
        urgency: "low",
        summary: "Filed FYI by owner",
      },
    ]);

    // The existing item was un-hidden in place (no new resurfaced_snooze item).
    const itemRows = await dbClient.execute({
      sql: `SELECT lane_at_snapshot, dismissed_from_today_at, source
            FROM ea_briefing_snapshot_items WHERE triage_id = ?`,
      args: [triageId],
    });
    expect(itemRows.rows).toEqual([
      { lane_at_snapshot: "fyi", dismissed_from_today_at: null, source: null },
    ]);

    // It resurfaces in its real 'fyi' lane, not needs_attention.
    const view = await getActiveSnapshotView("user-1", { dbClient, now });
    expect(view.lanes.needs_attention).toHaveLength(0);
    expect(view.lanes.fyi).toHaveLength(1);
    expect(view.lanes.fyi[0]).toMatchObject({ uid: "gmail-work-done-msg" });
  });

  it("leaves a snooze 'snoozed' when reattach throws, so the next tick retries it (P2-29)", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-04T17:30:00.000Z");
    const resurfacedAt = now.getTime();

    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, email_snapshot, status)
            VALUES (?, ?, ?, ?, 'snoozed')`,
      args: ["user-1", "gmail-work-msg-1", resurfacedAt - 1_000, JSON.stringify({
        uid: "gmail-work-msg-1",
        id: "gmail-work-msg-1",
        account_id: "gmail-work",
        account_email: "work@example.test",
        subject: "Wake this thread",
        lane: "needs_attention",
        read: false,
      })],
    });

    await wakeDueSnoozes({
      userId: "user-1",
      dbClient,
      now,
      loadUserConfigFn: vi.fn(async () => ({
        accounts: [{ id: "gmail-work", email: "work@example.test", type: "gmail" }],
      })),
      wakeAtGmailFn: vi.fn().mockResolvedValue(undefined),
      attachResurfacedSnoozeToActiveSnapshotFn: vi.fn().mockRejectedValue(new Error("attach failed")),
    });

    const row = await dbClient.execute(
      "SELECT status FROM ea_snoozed_emails WHERE user_id = 'user-1' AND email_id = 'gmail-work-msg-1'",
    );
    // Reattach threw, so the row must stay 'snoozed' for the next tick to retry,
    // not flip to 'resurfaced' (which would drop the email from the briefing).
    expect(row.rows[0]!.status).toBe("snoozed");
  });
});

describe("stopSnoozeWaker", () => {
  beforeEach(() => {
    cronApi.schedule.mockReset();
  });

  it("stops the scheduled cron job", () => {
    const job = { stop: vi.fn() };
    cronApi.schedule.mockReturnValue(job);

    startSnoozeWaker();
    stopSnoozeWaker();

    expect(job.stop).toHaveBeenCalledTimes(1);
  });

  it("is safe to call twice", () => {
    const job = { stop: vi.fn() };
    cronApi.schedule.mockReturnValue(job);

    startSnoozeWaker();
    stopSnoozeWaker();
    expect(() => stopSnoozeWaker()).not.toThrow();
    // Second call must not re-stop an already-cleared handle.
    expect(job.stop).toHaveBeenCalledTimes(1);
  });

  it("is safe to call when the waker was never started", () => {
    expect(() => stopSnoozeWaker()).not.toThrow();
  });
});
