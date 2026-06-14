import { describe, expect, it } from "vitest";
import {
  dismissSnapshotItemForToday,
  markSnapshotItemHandled,
  moveSnapshotItemLane,
  reopenSnapshotItem,
  restoreSnapshotItemForToday,
} from "./snapshot-item-mutations.js";
import {
  getActiveSnapshotView,
  getOrCreateActiveSnapshot,
} from "./snapshot-service.js";
import { createMigratedDb, seedSnapshotItem } from "./snapshot-test-fixtures.js";

describe("snapshot item mutations", () => {
  it("moves an active snapshot item between lanes and records feedback", async () => {
    const dbClient = await createMigratedDb();
    const { itemId, triageId } = await seedSnapshotItem(dbClient);

    const moved = await moveSnapshotItemLane("user-1", itemId, "fyi", {
      dbClient,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });

    expect(moved).toMatchObject({
      id: itemId,
      triage_id: triageId,
      lane: "fyi",
      lane_at_snapshot: "fyi",
    });

    const rows = await dbClient.execute({
      sql: `SELECT i.lane_at_snapshot, t.lane, f.feedback_type, f.from_value, f.to_value
            FROM ea_briefing_snapshot_items i
            JOIN ea_email_triage t ON t.id = i.triage_id
            JOIN ea_triage_feedback f ON f.snapshot_item_id = i.id
            WHERE i.id = ?`,
      args: [itemId],
    });

    expect(rows.rows).toEqual([
      {
        lane_at_snapshot: "fyi",
        lane: "fyi",
        feedback_type: "lane_move",
        from_value: "needs_attention",
        to_value: "fyi",
      },
    ]);

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });
    expect(view.lanes.needs_attention).toHaveLength(0);
    expect(view.lanes.fyi.map((item) => item.email_id)).toEqual(["msg-1"]);
  });

  it("dismisses an active snapshot item from today without changing canonical provider state", async () => {
    const dbClient = await createMigratedDb();
    const { itemId } = await seedSnapshotItem(dbClient, {
      emailId: "msg-dismiss",
      lane: "fyi",
    });

    const dismissed = await dismissSnapshotItemForToday("user-1", itemId, {
      dbClient,
      now: new Date("2026-05-03T16:05:00.000Z"),
    });

    expect(dismissed).toMatchObject({
      id: itemId,
      dismissed_from_today_at: "2026-05-03T16:05:00.000Z",
    });

    const rows = await dbClient.execute({
      sql: `SELECT i.dismissed_from_today_at, t.lane, t.provider_state, t.dismissed_at,
                   f.feedback_type, f.from_value, f.to_value
            FROM ea_briefing_snapshot_items i
            JOIN ea_email_triage t ON t.id = i.triage_id
            JOIN ea_triage_feedback f ON f.snapshot_item_id = i.id
            WHERE i.id = ?`,
      args: [itemId],
    });

    expect(rows.rows).toEqual([
      {
        dismissed_from_today_at: "2026-05-03T16:05:00.000Z",
        lane: "fyi",
        provider_state: "available",
        dismissed_at: null,
        feedback_type: "dismiss_today",
        from_value: "visible",
        to_value: "dismissed",
      },
    ]);

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:05:00.000Z"),
    });
    expect(view.lanes.fyi).toHaveLength(0);
  });

  it("durably skips pending snapshot triage when dismissing pending grace rows", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-03T16:00:00.000Z");
    const snapshot = await getOrCreateActiveSnapshot("user-1", { dbClient, now });
    const triageResult = await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, triage_status, triage_source)
            VALUES (?, ?, ?, 'needs_attention', 'security', 'pending', 'weak_security_grace')
            RETURNING id`,
      args: ["user-1", "gmail-work", "msg-pending-grace"],
    });
    const triageId = Number(triageResult.rows[0].id);
    const itemResult = await dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, category_at_snapshot, subject_at_snapshot,
               source, source_at)
            VALUES (?, ?, ?, ?, ?, 'needs_attention', 'Security triage pending.',
                    'Classifying soon', 'normal', 'security', 'New sign-in',
                    'pending_security_grace', '2026-05-03T16:10:00.000Z')
            RETURNING id`,
      args: [snapshot.id, triageId, "user-1", "gmail-work", "msg-pending-grace"],
    });
    const itemId = Number(itemResult.rows[0].id);
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, scheduled_for, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', 'queued', ?, ?)`,
      args: [
        "user-1",
        "gmail-work",
        "msg-pending-grace",
        "2026-05-03T16:10:00.000Z",
        "email_triage:user-1:gmail-work:msg-pending-grace",
      ],
    });

    await dismissSnapshotItemForToday("user-1", itemId, {
      dbClient,
      now: new Date("2026-05-03T16:05:00.000Z"),
    });

    const rows = await dbClient.execute({
      sql: `SELECT i.dismissed_from_today_at,
                   t.dismissed_at,
                   t.triage_status,
                   t.triage_source,
                   t.lane,
                   j.status,
                   j.completed_at,
                   j.scheduled_for,
                   j.last_error
            FROM ea_briefing_snapshot_items i
            JOIN ea_email_triage t ON t.id = i.triage_id
            JOIN ea_triage_jobs j ON j.user_id = i.user_id
             AND j.account_id = i.account_id
             AND j.email_id = i.email_id
             AND j.job_type = 'email_triage'
            WHERE i.id = ?`,
      args: [itemId],
    });

    expect(rows.rows).toEqual([
      {
        dismissed_from_today_at: "2026-05-03T16:05:00.000Z",
        dismissed_at: "2026-05-03T16:05:00.000Z",
        triage_status: "skipped",
        triage_source: "user_dismissed_pending",
        lane: "needs_attention",
        status: "complete",
        completed_at: "2026-05-03T16:05:00.000Z",
        scheduled_for: null,
        last_error: "Skipped pending triage; user dismissed row",
      },
    ]);

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:05:00.000Z"),
    });
    expect(view.lanes.needs_attention).toHaveLength(0);
    expect(view.laneCounts.needs_attention).toBe(0);
  });

  it("restores a dismissed active snapshot item without changing completed triage", async () => {
    const dbClient = await createMigratedDb();
    const { itemId } = await seedSnapshotItem(dbClient, {
      emailId: "msg-dismissed-complete",
    });
    await dismissSnapshotItemForToday("user-1", itemId, {
      dbClient,
      now: new Date("2026-05-03T16:05:00.000Z"),
    });

    const restored = await restoreSnapshotItemForToday("user-1", itemId, { dbClient });

    expect(restored.dismissed_from_today_at).toBeNull();
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status, t.triage_source, i.dismissed_from_today_at, j.status
            FROM ea_email_triage t
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            LEFT JOIN ea_triage_jobs j ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            WHERE i.id = ?`,
      args: [itemId],
    });
    expect(rows.rows).toEqual([
      {
        triage_status: "complete",
        triage_source: "unknown",
        dismissed_from_today_at: null,
        status: null,
      },
    ]);
  });

  it("marks a Needs Attention item handled on the snapshot and canonical triage row", async () => {
    const dbClient = await createMigratedDb();
    const { itemId } = await seedSnapshotItem(dbClient, {
      emailId: "msg-handled",
      lane: "needs_attention",
    });

    const handled = await markSnapshotItemHandled("user-1", itemId, {
      dbClient,
      now: new Date("2026-05-03T16:10:00.000Z"),
    });

    expect(handled).toMatchObject({
      id: itemId,
      handled_at: "2026-05-03T16:10:00.000Z",
    });

    const rows = await dbClient.execute({
      sql: `SELECT i.handled_at AS item_handled_at, t.handled_at AS triage_handled_at,
                   f.feedback_type, f.from_value, f.to_value
            FROM ea_briefing_snapshot_items i
            JOIN ea_email_triage t ON t.id = i.triage_id
            JOIN ea_triage_feedback f ON f.snapshot_item_id = i.id
            WHERE i.id = ?`,
      args: [itemId],
    });

    expect(rows.rows).toEqual([
      {
        item_handled_at: "2026-05-03T16:10:00.000Z",
        triage_handled_at: "2026-05-03T16:10:00.000Z",
        feedback_type: "mark_handled",
        from_value: "unhandled",
        to_value: "handled",
      },
    ]);

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:10:00.000Z"),
    });
    expect(view.laneCounts).toMatchObject({
      needs_attention: 0,
      handled: 1,
    });
    expect(view.lanes.needs_attention).toHaveLength(0);
    expect(view.lanes.handled.map((item) => item.email_id)).toEqual(["msg-handled"]);
  });

  it("reopens an active handled FYI item back into FYI and clears canonical handled state", async () => {
    const dbClient = await createMigratedDb();
    const { itemId, triageId } = await seedSnapshotItem(dbClient, {
      emailId: "msg-reopen",
      lane: "fyi",
    });
    await markSnapshotItemHandled("user-1", itemId, {
      dbClient,
      now: new Date("2026-05-03T16:10:00.000Z"),
    });

    const reopened = await reopenSnapshotItem("user-1", itemId, {
      dbClient,
      now: new Date("2026-05-03T16:12:00.000Z"),
    });

    expect(reopened).toMatchObject({
      id: itemId,
      triage_id: triageId,
      lane: "fyi",
      lane_at_snapshot: "fyi",
      handled_at: null,
    });

    const rows = await dbClient.execute({
      sql: `SELECT i.handled_at AS item_handled_at, i.lane_at_snapshot, t.handled_at AS triage_handled_at,
                   t.lane, f.feedback_type, f.from_value, f.to_value
            FROM ea_briefing_snapshot_items i
            JOIN ea_email_triage t ON t.id = i.triage_id
            JOIN ea_triage_feedback f ON f.snapshot_item_id = i.id
            WHERE i.id = ?
            ORDER BY f.id`,
      args: [itemId],
    });

    expect(rows.rows).toEqual([
      expect.objectContaining({
        item_handled_at: null,
        triage_handled_at: null,
        lane_at_snapshot: "fyi",
        lane: "fyi",
        feedback_type: "mark_handled",
        from_value: "unhandled",
        to_value: "handled",
      }),
      {
        item_handled_at: null,
        triage_handled_at: null,
        lane_at_snapshot: "fyi",
        lane: "fyi",
        feedback_type: "reopen",
        from_value: "handled",
        to_value: "fyi",
      },
    ]);

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:12:00.000Z"),
    });
    expect(view.laneCounts).toMatchObject({
      fyi: 1,
      handled: 0,
    });
    expect(view.lanes.fyi.map((item) => item.email_id)).toEqual(["msg-reopen"]);
    expect(view.lanes.handled).toHaveLength(0);
  });
});
