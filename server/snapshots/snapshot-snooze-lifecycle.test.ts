import { describe, expect, it } from "vitest";
import {
  attachResurfacedSnoozeToActiveSnapshot,
  deferPendingTriageForSnooze,
  settleReadArrivalGraceRows,
} from "./snapshot-snooze-lifecycle.ts";
import {
  getActiveSnapshotView,
  getOrCreateActiveSnapshot,
} from "./snapshot-service.ts";
import { createMigratedDb } from "./snapshot-test-fixtures.ts";

describe("snapshot snooze lifecycle", () => {
  it("defers pending triage and hides the active snapshot item while snoozed", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-03T16:00:00.000Z");
    const until = Date.parse("2026-05-03T20:00:00.000Z");
    const snapshot = await getOrCreateActiveSnapshot("user-1", { dbClient, now });
    const triageResult = await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source)
            VALUES ('user-1', 'gmail-work', 'msg-snooze', 'pending', 'arrival_grace')
            RETURNING id`,
      args: [],
    });
    const triageId = Number(triageResult.rows[0]!.id);
    await dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, category_at_snapshot, subject_at_snapshot,
               source, source_at)
            VALUES (?, ?, 'user-1', 'gmail-work', 'msg-snooze', 'queued',
                    'Queued for triage.', 'Waiting briefly before triage.',
                    'normal', 'uncategorized', 'Snooze me',
                    'arrival_grace', '2026-05-03T16:03:00.000Z')`,
      args: [snapshot.id, triageId],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, scheduled_for, idempotency_key)
            VALUES ('user-1', 'gmail-work', 'msg-snooze', 'email_triage', 'queued',
                    '2026-05-03T16:03:00.000Z', 'email_triage:user-1:gmail-work:msg-snooze')`,
      args: [],
    });

    const result = await deferPendingTriageForSnooze("user-1", "gmail-work", "msg-snooze", until, {
      dbClient,
      now,
    });

    expect(result).toEqual({ updated: 1, jobsUpdated: 1, itemsHidden: 1 });
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   t.decision_metadata_json,
                   j.status AS job_status,
                   j.scheduled_for,
                   i.dismissed_from_today_at
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.email_id = t.email_id
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            WHERE t.email_id = 'msg-snooze'`,
      args: [],
    });
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.triage_status).toBe("pending");
    expect(row.triage_source).toBe("user_snoozed_pending");
    expect((JSON.parse(String(row.decision_metadata_json)) as { snoozedPending: unknown }).snoozedPending).toEqual({
      previousTriageSource: "arrival_grace",
      snoozedAt: now.toISOString(),
    });
    expect(row.job_status).toBe("queued");
    expect(row.scheduled_for).toBe("2026-05-03T20:00:00.000Z");
    expect(row.dismissed_from_today_at).toBe(now.toISOString());
  });

  it("attaches a woken snooze to the active snapshot in its remembered triage lane", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-03T16:00:00.000Z");

    const item = await attachResurfacedSnoozeToActiveSnapshot("user-1", {
      account_id: "gmail-work",
      uid: "msg-woken",
      lane: "fyi",
      subject: "Woken snooze",
      summary: "Snoozed earlier",
      from_name: "Sender",
      from_address: "sender@example.com",
      account_label: "Work",
      account_email: "work@example.com",
    }, { dbClient, now, resurfacedAt: now.getTime() });

    expect(item).toMatchObject({
      account_id: "gmail-work",
      email_id: "msg-woken",
      lane: "fyi",
      source: "resurfaced_snooze",
      _resurfaced: true,
      _resurfacedAt: now.getTime(),
      subject: "Woken snooze",
    });
    const triage = await dbClient.execute({
      sql: `SELECT lane, triage_status, triage_source, handled_at, dismissed_at
            FROM ea_email_triage
            WHERE email_id = 'msg-woken'`,
      args: [],
    });
    expect(triage.rows).toEqual([
      {
        lane: "fyi",
        triage_status: "complete",
        triage_source: "snooze_resurface",
        handled_at: null,
        dismissed_at: null,
      },
    ]);
  });

  it("keeps a woken snooze pending when its triage never completed", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-03T16:00:00.000Z");

    const item = await attachResurfacedSnoozeToActiveSnapshot("user-1", {
      account_id: "gmail-work",
      uid: "msg-woken-pending",
      lane: "queued",
      subject: "Still pending",
    }, { dbClient, now, pendingTriage: true });

    expect(item).toMatchObject({
      email_id: "msg-woken-pending",
      lane: "needs_attention",
      source: "resurfaced_snooze",
    });
    const triage = await dbClient.execute({
      sql: `SELECT triage_status, triage_source, last_triaged_at
            FROM ea_email_triage
            WHERE email_id = 'msg-woken-pending'`,
      args: [],
    });
    expect(triage.rows).toEqual([
      {
        triage_status: "pending",
        triage_source: "snooze_resurface_pending",
        last_triaged_at: null,
      },
    ]);
  });

  it("settles read arrival-grace rows when Inbox explicitly exits", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-03T16:00:00.000Z");
    const snapshot = await getOrCreateActiveSnapshot("user-1", { dbClient, now });
    await dbClient.execute({
      sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               from_name, from_address, subject, body_snippet, body_text, email_date, read)
            VALUES (?, 'user-1', 'gmail-work', 'Work', 'work@example.com',
                    'Reader', 'reader@example.com', 'Read in grace', 'Read it',
                    'Read it', '2026-05-03T15:58:00.000Z', 1)`,
      args: ["msg-arrival-read"],
    });
    const triageResult = await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source)
            VALUES ('user-1', 'gmail-work', ?, 'pending', 'arrival_grace')
            RETURNING id`,
      args: ["msg-arrival-read"],
    });
    const triageId = Number(triageResult.rows[0]!.id);
    await dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, category_at_snapshot, subject_at_snapshot,
               source, source_at)
            VALUES (?, ?, 'user-1', 'gmail-work', ?, 'queued',
                    'Queued for triage.', 'Waiting briefly before triage.',
                    'normal', 'uncategorized', 'Read in grace',
                    'arrival_grace', '2026-05-03T16:03:00.000Z')`,
      args: [snapshot.id, triageId, "msg-arrival-read"],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, scheduled_for, idempotency_key)
            VALUES ('user-1', 'gmail-work', ?, 'email_triage', 'queued',
                    '2026-05-03T16:03:00.000Z', ?)`,
      args: ["msg-arrival-read", "email_triage:user-1:gmail-work:msg-arrival-read"],
    });

    await settleReadArrivalGraceRows("user-1", { dbClient, now });
    const view = await getActiveSnapshotView("user-1", { dbClient, now });

    expect(view.lanes.untriaged_read.map((item) => item.email_id)).toEqual(["msg-arrival-read"]);
  });
});
