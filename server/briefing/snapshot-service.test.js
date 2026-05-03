import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  advanceSnapshotBoundary,
  getActiveSnapshotView,
  getOrCreateActiveSnapshot,
  dismissSnapshotItemForToday,
  markProviderRemovedFromActiveSnapshots,
  markSnapshotItemHandled,
  moveSnapshotItemLane,
} from "./snapshot-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const emailIndexMigrationSql = readFileSync(
  join(__dirname, "../db/migrations/016_email_search_index.sql"),
  "utf8",
);
const migrationSql = readFileSync(
  join(__dirname, "../db/migrations/030_triage_snapshots.sql"),
  "utf8",
);

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(emailIndexMigrationSql);
  await db.executeMultiple(migrationSql);
  return db;
}

async function seedSnapshotItem(dbClient, {
  userId = "user-1",
  accountId = "gmail-work",
  emailId = "msg-1",
  lane = "needs_attention",
  category = "school",
  now = new Date("2026-05-03T15:00:00.000Z"),
} = {}) {
  const snapshot = await getOrCreateActiveSnapshot(userId, { dbClient, now });
  const triageResult = await dbClient.execute({
    sql: `INSERT INTO ea_email_triage
            (user_id, account_id, email_id, lane, category, triage_status)
          VALUES (?, ?, ?, ?, ?, 'complete')
          RETURNING id`,
    args: [userId, accountId, emailId, lane, category],
  });
  const triageId = Number(triageResult.rows[0].id);
  const itemResult = await dbClient.execute({
    sql: `INSERT INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
             urgency_at_snapshot, category_at_snapshot, subject_at_snapshot)
          VALUES (?, ?, ?, ?, ?, ?, 'Summary', 'Review', 'normal', ?, 'Subject')
          RETURNING id`,
    args: [snapshot.id, triageId, userId, accountId, emailId, lane, category],
  });
  return {
    snapshot,
    triageId,
    itemId: Number(itemResult.rows[0].id),
  };
}

describe("active briefing snapshots", () => {
  it("opens one deterministic PT daily snapshot per user", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-03T07:30:00.000Z");

    const first = await getOrCreateActiveSnapshot("user-1", { dbClient, now });
    const second = await getOrCreateActiveSnapshot("user-1", { dbClient, now });

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      user_id: "user-1",
      timezone: "America/Los_Angeles",
      status: "active",
      start_at: "2026-05-03T07:00:00.000Z",
      end_at: "2026-05-04T07:00:00.000Z",
    });

    const rows = await dbClient.execute({
      sql: "SELECT * FROM ea_briefing_snapshots WHERE user_id = ?",
      args: ["user-1"],
    });
    expect(rows.rows).toHaveLength(1);
  });

  it("freezes expired active windows when opening the next PT day", async () => {
    const dbClient = await createMigratedDb();

    const previous = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T07:30:00.000Z"),
    });
    const next = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-04T07:30:00.000Z"),
    });

    expect(next.id).not.toBe(previous.id);

    const rows = await dbClient.execute({
      sql: "SELECT id, status, frozen_at FROM ea_briefing_snapshots WHERE user_id = ? ORDER BY id",
      args: ["user-1"],
    });

    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: previous.id,
        status: "frozen",
        frozen_at: "2026-05-04T07:30:00.000Z",
      }),
      expect.objectContaining({
        id: next.id,
        status: "active",
        frozen_at: null,
      }),
    ]);
  });

  it("advances a scheduled snapshot boundary by freezing the current active window", async () => {
    const dbClient = await createMigratedDb();
    const initial = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T07:30:00.000Z"),
    });

    const result = await advanceSnapshotBoundary("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:30:00.000Z"),
      timeZone: "America/Los_Angeles",
      scheduleLabel: "Morning",
    });

    expect(result.schedule_label).toBe("Morning");
    expect(result.snapshot).toMatchObject({
      user_id: "user-1",
      timezone: "America/Los_Angeles",
      status: "active",
      start_at: "2026-05-03T15:30:00.000Z",
      end_at: "2026-05-04T07:00:00.000Z",
    });

    const rows = await dbClient.execute({
      sql: "SELECT id, status, start_at, end_at, frozen_at FROM ea_briefing_snapshots WHERE user_id = ? ORDER BY id",
      args: ["user-1"],
    });
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: initial.id,
        status: "frozen",
        start_at: "2026-05-03T07:00:00.000Z",
        end_at: "2026-05-03T15:30:00.000Z",
        frozen_at: "2026-05-03T15:30:00.000Z",
      }),
      expect.objectContaining({
        id: result.snapshot.id,
        status: "active",
        start_at: "2026-05-03T15:30:00.000Z",
        end_at: "2026-05-04T07:00:00.000Z",
      }),
    ]);

    const current = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });
    expect(current.id).toBe(result.snapshot.id);
  });

  it("keeps the new schema idempotent around triage rows, jobs, and snapshot items", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.executeMultiple(migrationSql);

    await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, thread_id, lane, triage_status)
            VALUES (?, ?, ?, ?, 'fyi', 'complete')`,
      args: ["user-1", "gmail-work", "msg-1", "thread-1"],
    });
    await expect(dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, thread_id)
            VALUES (?, ?, ?, ?)`,
      args: ["user-1", "gmail-work", "msg-1", "thread-duplicate"],
    })).rejects.toThrow();

    const snapshot = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T07:30:00.000Z"),
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, deadline_at_snapshot, category_at_snapshot,
               sort_order)
            VALUES (?, 1, ?, ?, ?, 'fyi', 'Frozen summary', 'Read later',
                    'low', '2026-05-05T16:00:00.000Z', 'school', 10)`,
      args: [snapshot.id, "user-1", "gmail-work", "msg-1"],
    });
    await expect(dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot)
            VALUES (?, 1, ?, ?, ?, 'noise')`,
      args: [snapshot.id, "user-1", "gmail-work", "msg-1"],
    })).rejects.toThrow();

    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', ?)`,
      args: ["user-1", "gmail-work", "msg-1", "triage:user-1:gmail-work:msg-1"],
    });
    await expect(dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', ?)`,
      args: ["user-1", "gmail-work", "msg-1", "triage:user-1:gmail-work:msg-1"],
    })).rejects.toThrow();
  });

  it("returns a grouped active snapshot swimlane view with processing and filters", async () => {
    const dbClient = await createMigratedDb();
    const snapshot = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    for (const [emailId, lane, category, accountId, sortOrder, isCarryover] of [
      ["msg-action", "needs_attention", "finance", "gmail-work", 10, 0],
      ["msg-fyi", "fyi", "school", "icloud-home", 20, 0],
      ["msg-noise", "noise", "marketing", "gmail-work", 30, 0],
      ["msg-carry", "needs_attention", "legal", "gmail-work", 5, 1],
    ]) {
      await dbClient.execute({
        sql: `INSERT INTO ea_email_triage
                (user_id, account_id, email_id, lane, category, triage_status)
              VALUES (?, ?, ?, ?, ?, 'complete')`,
        args: ["user-1", accountId, emailId, lane, category],
      });
      await dbClient.execute({
        sql: `INSERT INTO ea_briefing_snapshot_items
                (snapshot_id, triage_id, user_id, account_id, email_id,
                 lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
                 urgency_at_snapshot, category_at_snapshot,
                 escalation_badge_at_snapshot, subject_at_snapshot,
                 from_name_at_snapshot, from_address_at_snapshot,
                 email_date_at_snapshot, account_label_at_snapshot,
                 account_email_at_snapshot, account_color_at_snapshot,
                 account_icon_at_snapshot, sort_order, is_carryover)
              VALUES (?, last_insert_rowid(), ?, ?, ?, ?, ?, ?, 'normal', ?, NULL, ?, ?, ?,
                      '2026-05-03T14:00:00.000Z', ?, ?, '#cba6da', 'Mail', ?, ?)`,
        args: [
          snapshot.id,
          "user-1",
          accountId,
          emailId,
          lane,
          `Summary ${emailId}`,
          lane === "noise" ? "Ignore" : "Review",
          category,
          `Subject ${emailId}`,
          `Sender ${emailId}`,
          `${emailId}@example.test`,
          accountId === "gmail-work" ? "Work Gmail" : "Home iCloud",
          accountId === "gmail-work" ? "work@example.test" : "home@example.test",
          sortOrder,
          isCarryover,
        ],
      });
    }

    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, idempotency_key)
            VALUES
              ('user-1', 'gmail-work', 'msg-pending', 'email_triage', 'queued', 'queued-1'),
              ('user-1', 'gmail-work', 'msg-running', 'email_triage', 'running', 'running-1'),
              ('user-2', 'gmail-work', 'msg-other', 'email_triage', 'queued', 'queued-other')`,
    });

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    expect(view.snapshot.id).toBe(snapshot.id);
    expect(view.processing).toEqual({
      queued: 1,
      running: 1,
      total: 2,
      active: true,
    });
    expect(view.laneCounts).toEqual({
      needs_attention: 1,
      fyi: 1,
      noise: 1,
      carryover: 1,
    });
    expect(view.lanes.needs_attention.map((item) => item.email_id)).toEqual(["msg-action"]);
    expect(view.lanes.fyi.map((item) => item.email_id)).toEqual(["msg-fyi"]);
    expect(view.lanes.noise.map((item) => item.email_id)).toEqual(["msg-noise"]);
    expect(view.carryover.map((item) => item.email_id)).toEqual(["msg-carry"]);
    expect(view.filters.accounts).toEqual([
      { account_id: "gmail-work", label: "Work Gmail", email: "work@example.test", color: "#cba6da", icon: "Mail", count: 3 },
      { account_id: "icloud-home", label: "Home iCloud", email: "home@example.test", color: "#cba6da", icon: "Mail", count: 1 },
    ]);
    expect(view.filters.categories).toEqual([
      { category: "finance", count: 1 },
      { category: "legal", count: 1 },
      { category: "marketing", count: 1 },
      { category: "school", count: 1 },
    ]);
  });

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
    expect(view.lanes.needs_attention).toHaveLength(0);
  });

  it("carries only unresolved Needs Attention items into the next daily window", async () => {
    const dbClient = await createMigratedDb();
    const previousNow = new Date("2026-05-03T15:00:00.000Z");

    const unresolved = await seedSnapshotItem(dbClient, {
      emailId: "msg-unresolved",
      lane: "needs_attention",
      now: previousNow,
    });
    await seedSnapshotItem(dbClient, {
      emailId: "msg-fyi",
      lane: "fyi",
      now: previousNow,
    });
    await seedSnapshotItem(dbClient, {
      emailId: "msg-noise",
      lane: "noise",
      now: previousNow,
    });
    const dismissed = await seedSnapshotItem(dbClient, {
      emailId: "msg-dismissed",
      lane: "needs_attention",
      now: previousNow,
    });
    const handled = await seedSnapshotItem(dbClient, {
      emailId: "msg-handled",
      lane: "needs_attention",
      now: previousNow,
    });
    const removed = await seedSnapshotItem(dbClient, {
      emailId: "msg-removed",
      lane: "needs_attention",
      now: previousNow,
    });

    await dbClient.execute({
      sql: "UPDATE ea_briefing_snapshot_items SET dismissed_from_today_at = ? WHERE id = ?",
      args: ["2026-05-03T18:00:00.000Z", dismissed.itemId],
    });
    await dbClient.execute({
      sql: "UPDATE ea_email_triage SET handled_at = ? WHERE id = ?",
      args: ["2026-05-03T18:05:00.000Z", handled.triageId],
    });
    await dbClient.execute({
      sql: "UPDATE ea_email_triage SET provider_state = 'archived' WHERE id = ?",
      args: [removed.triageId],
    });

    const nextView = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    expect(nextView.snapshot.start_at).toBe("2026-05-04T07:00:00.000Z");
    expect(nextView.carryover.map((item) => ({
      email_id: item.email_id,
      triage_id: item.triage_id,
      lane: item.lane,
      is_carryover: item.is_carryover,
    }))).toEqual([
      {
        email_id: "msg-unresolved",
        triage_id: unresolved.triageId,
        lane: "needs_attention",
        is_carryover: true,
      },
    ]);
    expect(nextView.laneCounts).toMatchObject({
      needs_attention: 0,
      fyi: 0,
      noise: 0,
      carryover: 1,
    });

    const secondLoad = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-04T16:00:00.000Z"),
    });
    expect(secondLoad.carryover.map((item) => item.email_id)).toEqual(["msg-unresolved"]);
  });

  it("hides provider-archived or trashed messages from active lanes while preserving rows", async () => {
    const dbClient = await createMigratedDb();
    const { itemId, triageId } = await seedSnapshotItem(dbClient, {
      accountId: "gmail-work",
      emailId: "msg-archived",
      lane: "needs_attention",
    });

    const result = await markProviderRemovedFromActiveSnapshots(
      "user-1",
      "gmail-work",
      "msg-archived",
      "archived",
      {
        dbClient,
        now: new Date("2026-05-03T16:15:00.000Z"),
      },
    );

    expect(result).toEqual({ updated: 1 });

    const rows = await dbClient.execute({
      sql: `SELECT i.id, i.provider_removed_at, t.id AS triage_id, t.provider_state,
                   f.feedback_type, f.from_value, f.to_value
            FROM ea_briefing_snapshot_items i
            JOIN ea_email_triage t ON t.id = i.triage_id
            JOIN ea_triage_feedback f ON f.snapshot_item_id = i.id
            WHERE i.id = ?`,
      args: [itemId],
    });

    expect(rows.rows).toEqual([
      {
        id: itemId,
        provider_removed_at: "2026-05-03T16:15:00.000Z",
        triage_id: triageId,
        provider_state: "archived",
        feedback_type: "provider_removed",
        from_value: "available",
        to_value: "archived",
      },
    ]);

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:15:00.000Z"),
    });
    expect(view.lanes.needs_attention).toHaveLength(0);

    const preserved = await dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM ea_briefing_snapshot_items WHERE id = ?",
      args: [itemId],
    });
    expect(Number(preserved.rows[0].count)).toBe(1);
  });
});
