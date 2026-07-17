import { describe, expect, it, vi } from "vitest";
import { pin } from "../email/pinned-emails.js";
import {
  advanceSnapshotBoundary,
  CARRYOVER_MAX_DEPTH,
  getActiveSnapshotView,
  getOrCreateActiveSnapshot,
  getSnapshotViewById,
  markProviderRemovedFromActiveSnapshots,
  markSnapshotItemHandled,
  syncActiveSnapshot,
} from "./snapshot-service.ts";
import { createMigratedDb, migrationSql, seedSnapshotItem } from "./snapshot-test-fixtures.ts";
import type { UserConfig } from "../platform/config-service.ts";

const pinWithSnapshot = pin as unknown as (
  userId: string,
  emailId: string,
  snapshot: Record<string, unknown>,
  options: { dbClient: Awaited<ReturnType<typeof createMigratedDb>> },
) => Promise<unknown>;

const syncUserConfig = (): UserConfig => ({
  accounts: [],
  settings: { email_lookback_hours: 16 } as unknown as UserConfig["settings"],
});

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
        id: result.snapshot!.id,
        status: "active",
        start_at: "2026-05-03T15:30:00.000Z",
        end_at: "2026-05-04T07:00:00.000Z",
      }),
    ]);

    const current = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });
    expect(current.id).toBe(result.snapshot!.id);
  });

  it("freezes an already-expired active snapshot when advancing past its window (P1-11)", async () => {
    const dbClient = await createMigratedDb();
    const initial = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T07:30:00.000Z"),
    });

    // Advance AFTER the initial window's end_at (2026-05-04T07:00Z) with NO
    // intervening read to lazily freeze it. The scheduled-advance path must
    // freeze the now-expired window itself, or two 'active' rows coexist and
    // direct active-targeting queries mutate items across both.
    const result = await advanceSnapshotBoundary("user-1", {
      dbClient,
      now: new Date("2026-05-04T08:00:00.000Z"),
      timeZone: "America/Los_Angeles",
      scheduleLabel: "Morning",
    });

    const active = await dbClient.execute({
      sql: "SELECT COUNT(*) AS n FROM ea_briefing_snapshots WHERE user_id = ? AND status = 'active'",
      args: ["user-1"],
    });
    expect(Number(active.rows[0]!.n)).toBe(1);
    expect(result.snapshot!.status).toBe("active");

    // The expired row must be frozen with its REAL end_at preserved (not
    // rewritten to now) — this is why freezeExpiredActiveSnapshots is used
    // rather than widening freezeActiveSnapshotsAtBoundary's predicate.
    const prior = await dbClient.execute({
      sql: "SELECT status, end_at FROM ea_briefing_snapshots WHERE id = ?",
      args: [initial.id],
    });
    expect(prior.rows[0]!.status).toBe("frozen");
    expect(prior.rows[0]!.end_at).toBe("2026-05-04T07:00:00.000Z");
  });

  it("persists schedule labels and lists active before frozen snapshot history", async () => {
    const dbClient = await createMigratedDb();
    const initial = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T07:30:00.000Z"),
    });
    await advanceSnapshotBoundary("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:30:00.000Z"),
      scheduleLabel: "Morning",
    });
    const current = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });

    await seedSnapshotItem(dbClient, {
      emailId: "msg-current",
      lane: "needs_attention",
      now: new Date("2026-05-03T16:00:00.000Z"),
    });

    const { getSnapshotHistory } = await import("./snapshot-service.ts");
    const history = await getSnapshotHistory("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });

    expect(history.snapshots.map((snapshot) => snapshot.id)).toEqual([current.id, initial.id]);
    expect(history.snapshots).toEqual([
      expect.objectContaining({
        id: current.id,
        status: "active",
        readOnly: false,
        schedule_label: "Morning",
        laneCounts: expect.objectContaining({ needs_attention: 1, fyi: 0, handled: 0, noise: 0, carryover: 0 }),
      }),
      expect.objectContaining({
        id: initial.id,
        status: "frozen",
        readOnly: true,
        schedule_label: null,
      }),
    ]);

    const rows = await dbClient.execute({
      sql: "SELECT schedule_label FROM ea_briefing_snapshots WHERE id = ?",
      args: [current.id],
    });
    expect(rows.rows[0]!.schedule_label).toBe("Morning");
  });

  it("loads active and frozen snapshot detail with read-only status", async () => {
    const dbClient = await createMigratedDb();
    const initial = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T07:30:00.000Z"),
    });
    const frozenItem = await seedSnapshotItem(dbClient, {
      emailId: "msg-frozen",
      lane: "fyi",
      now: new Date("2026-05-03T07:30:00.000Z"),
    });
    await markSnapshotItemHandled("user-1", frozenItem.itemId, {
      dbClient,
      now: new Date("2026-05-03T08:00:00.000Z"),
    });
    await advanceSnapshotBoundary("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:30:00.000Z"),
      scheduleLabel: "Afternoon",
    });
    const active = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });

    const { getSnapshotViewById } = await import("./snapshot-service.ts");
    const frozenView = await getSnapshotViewById("user-1", initial.id, { dbClient });
    const activeView = await getSnapshotViewById("user-1", active.id, { dbClient });

    expect(frozenView).toMatchObject({
      readOnly: true,
      snapshot: expect.objectContaining({ id: initial.id, status: "frozen" }),
      lanes: expect.objectContaining({ handled: [expect.objectContaining({ email_id: "msg-frozen" })] }),
      laneCounts: expect.objectContaining({ handled: 1, fyi: 0 }),
    });
    expect(activeView).toMatchObject({
      readOnly: false,
      snapshot: expect.objectContaining({
        id: active.id,
        status: "active",
        schedule_label: "Afternoon",
      }),
    });
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

    await dbClient.execute({
      sql: `INSERT INTO ea_accounts
              (id, user_id, type, email, label, color, icon, sort_order, created_at)
            VALUES
              ('gmail-work', 'user-1', 'gmail', 'work@example.test', 'Work Gmail', '#cba6da', 'Mail', 20, '2026-05-01T10:00:00.000Z'),
              ('icloud-home', 'user-1', 'icloud', 'home@example.test', 'Home iCloud', '#cba6da', 'Mail', 10, '2026-05-02T10:00:00.000Z')`,
    });

    for (const [emailId, lane, category, accountId, sortOrder, isCarryover] of ([
      ["msg-action", "needs_attention", "finance", "gmail-work", 10, 0],
      ["msg-fyi", "fyi", "school", "icloud-home", 20, 0],
      ["msg-noise", "noise", "marketing", "gmail-work", 30, 0],
      ["msg-carry", "needs_attention", "legal", "gmail-work", 5, 1],
      ["msg-unknown", "fyi", "travel", "unknown-account", 40, 0],
    ] as const)) {
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
          accountId === "gmail-work"
            ? "Work Gmail"
            : accountId === "icloud-home"
              ? "Home iCloud"
              : "Unknown Account",
          accountId === "gmail-work"
            ? "work@example.test"
            : accountId === "icloud-home"
              ? "home@example.test"
              : "unknown@example.test",
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
              ('user-1', 'gmail-work', NULL, 'gmail_history_sync', 'queued', 'history-queued-1'),
              ('user-1', 'gmail-work', NULL, 'gmail_history_sync', 'running', 'history-running-1'),
              ('user-2', 'gmail-work', 'msg-other', 'email_triage', 'queued', 'queued-other')`,
    });

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    expect(view.snapshot!.id).toBe(snapshot.id);
    expect(view.processing).toEqual({
      queued: 1,
      running: 1,
      total: 2,
      active: true,
      email_triage_mode: "auto",
      effective_email_triage_mode: "no_model",
      email_triage: {
        pending: 1,
        queued: 1,
        running: 1,
        total: 2,
        active: true,
      },
      gmail_history_sync: {
        pending: 1,
        queued: 1,
        running: 1,
        total: 2,
        active: true,
      },
    });
    expect(view.laneCounts).toEqual({
      queued: 0,
      needs_attention: 1,
      fyi: 2,
      handled: 0,
      untriaged_read: 0,
      noise: 1,
      carryover: 1,
    });
    expect(view.lanes.needs_attention.map((item) => item.email_id)).toEqual(["msg-action"]);
    expect(view.lanes.fyi.map((item) => item.email_id)).toEqual(["msg-fyi", "msg-unknown"]);
    expect(view.lanes.noise.map((item) => item.email_id)).toEqual(["msg-noise"]);
    expect(view.carryover.map((item) => item.email_id)).toEqual(["msg-carry"]);
    expect(view.filters.accounts).toEqual([
      { account_id: "icloud-home", label: "Home iCloud", email: "home@example.test", color: "#cba6da", icon: "Mail", count: 1 },
      { account_id: "gmail-work", label: "Work Gmail", email: "work@example.test", color: "#cba6da", icon: "Mail", count: 3 },
      { account_id: "unknown-account", label: "Unknown Account", email: "unknown@example.test", color: "#cba6da", icon: "Mail", count: 1 },
    ]);
    expect(view.filters.categories).toEqual([
      { category: "finance", count: 1 },
      { category: "legal", count: 1 },
      { category: "marketing", count: 1 },
      { category: "school", count: 1 },
      { category: "travel", count: 1 },
    ]);
  });

  it("surfaces unread FYI from the previous snapshot as active-only catch-up", async () => {
    const dbClient = await createMigratedDb();
    const previous = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    for (const [emailId, lane, read] of ([
      ["late-fyi-unread", "fyi", 0],
      ["late-fyi-read", "fyi", 1],
      ["late-noise-unread", "noise", 0],
    ] as const)) {
      await dbClient.execute({
        sql: `INSERT INTO ea_email_index
                (uid, user_id, account_id, account_label, account_email,
                 from_name, from_address, subject, body_snippet, body_text,
                 email_date, read)
              VALUES (?, 'user-1', 'gmail-work', 'Work Gmail', 'work@example.test',
                      'Sender', 'sender@example.test', ?, 'Snippet', 'Body',
                      '2026-05-03T14:30:00.000Z', ?)`,
        args: [emailId, `Subject ${emailId}`, read],
      });
      await dbClient.execute({
        sql: `INSERT INTO ea_email_triage
                (user_id, account_id, email_id, lane, category, triage_status)
              VALUES ('user-1', 'gmail-work', ?, ?, 'updates', 'complete')`,
        args: [emailId, lane],
      });
      await dbClient.execute({
        sql: `INSERT INTO ea_briefing_snapshot_items
                (snapshot_id, triage_id, user_id, account_id, email_id,
                 lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
                 urgency_at_snapshot, category_at_snapshot, subject_at_snapshot,
                 from_name_at_snapshot, from_address_at_snapshot, email_date_at_snapshot,
                 account_label_at_snapshot, account_email_at_snapshot,
                 account_color_at_snapshot, account_icon_at_snapshot, sort_order)
              VALUES (?, last_insert_rowid(), 'user-1', 'gmail-work', ?, ?,
                      'Summary', 'Review', 'normal', 'updates', ?,
                      'Sender', 'sender@example.test', '2026-05-03T14:30:00.000Z',
                      'Work Gmail', 'work@example.test', '#cba6da', 'Mail', 10)`,
        args: [previous.id, emailId, lane, `Subject ${emailId}`],
      });
    }

    const active = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });
    expect(active.id).not.toBe(previous.id);

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });
    const historicalView = await getSnapshotViewById("user-1", previous.id, { dbClient });

    expect(view.lanes.catch_up!.map((item) => item.email_id)).toEqual(["late-fyi-unread"]);
    expect(view.lanes.catch_up![0]).toMatchObject({
      lane: "catch_up",
      lane_at_snapshot: "fyi",
      read: false,
      source: "catch_up",
    });
    expect(view.laneCounts.catch_up).toBe(1);
    expect(view.filters.accounts).toEqual([
      expect.objectContaining({ account_id: "gmail-work", count: 1 }),
    ]);
    expect(view.filters.categories).toEqual([{ category: "updates", count: 1 }]);
    const activeItems = await dbClient.execute({
      sql: `SELECT email_id
            FROM ea_briefing_snapshot_items
            WHERE snapshot_id = ?
            ORDER BY email_id`,
      args: [active.id],
    });
    expect(activeItems.rows.map((row) => row.email_id)).toEqual([]);
    expect(historicalView.lanes.catch_up).toBeUndefined();
    expect(historicalView.laneCounts.catch_up).toBeUndefined();
    expect(historicalView.lanes.fyi.map((item) => item.email_id)).toEqual(["late-fyi-unread", "late-fyi-read"]);
  });

  it("keeps read arrival-grace rows queued during active snapshot reconciliation", async () => {
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

    const first = await getActiveSnapshotView("user-1", { dbClient, now });
    const second = await getActiveSnapshotView("user-1", { dbClient, now });

    expect(first.lanes.queued.map((item) => item.email_id)).toEqual(["msg-arrival-read"]);
    expect(first.lanes.queued[0]).toMatchObject({
      from_name: "Reader",
      from_address: "reader@example.com",
      from: "Reader",
    });
    expect(second.lanes.queued.map((item) => item.email_id)).toEqual(["msg-arrival-read"]);
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   j.completed_at,
                   i.lane_at_snapshot,
                   i.source
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.email_id = t.email_id
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            WHERE t.email_id = ?`,
      args: ["msg-arrival-read"],
    });
    expect(rows.rows).toEqual([
      {
        triage_status: "pending",
        triage_source: "arrival_grace",
        job_status: "queued",
        completed_at: null,
        lane_at_snapshot: "queued",
        source: "arrival_grace",
      },
    ]);
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

    expect(nextView.snapshot!.start_at).toBe("2026-05-04T07:00:00.000Z");
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

  it("carries queued arrival-grace rows across snapshot boundaries without resetting their deadline", async () => {
    const dbClient = await createMigratedDb();
    const previousNow = new Date("2026-05-03T18:00:00.000Z");
    const previous = await getOrCreateActiveSnapshot("user-1", { dbClient, now: previousNow });
    const triageResult = await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source)
            VALUES ('user-1', 'gmail-work', 'msg-queued-carry', 'pending', 'arrival_grace')
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
            VALUES (?, ?, 'user-1', 'gmail-work', 'msg-queued-carry',
                    'queued', 'Queued for triage.', 'Waiting briefly before triage.',
                    'normal', 'uncategorized', 'Queued carry',
                    'arrival_grace', '2026-05-03T18:03:00.000Z')`,
      args: [previous.id, triageId],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, scheduled_for, idempotency_key)
            VALUES ('user-1', 'gmail-work', 'msg-queued-carry', 'email_triage',
                    'queued', '2026-05-03T18:03:00.000Z',
                    'email_triage:user-1:gmail-work:msg-queued-carry')`,
      args: [],
    });

    const nextView = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    expect(nextView.carryover.map((item) => ({
      email_id: item.email_id,
      lane: item.lane,
      source: item.source,
      source_at: item.source_at,
      is_carryover: item.is_carryover,
    }))).toEqual([
      {
        email_id: "msg-queued-carry",
        lane: "queued",
        source: "arrival_grace",
        source_at: "2026-05-03T18:03:00.000Z",
        is_carryover: true,
      },
    ]);
    const job = await dbClient.execute({
      sql: "SELECT scheduled_for FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-queued-carry"],
    });
    expect(job.rows[0]!.scheduled_for).toBe("2026-05-03T18:03:00.000Z");
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
    expect(Number(preserved.rows[0]!.count)).toBe(1);
  });

  it("completes pending triage jobs when provider removal hides active rows", async () => {
    const dbClient = await createMigratedDb();
    const { itemId } = await seedSnapshotItem(dbClient, {
      accountId: "gmail-work",
      emailId: "msg-pending-trash",
      lane: "needs_attention",
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET triage_status = 'pending'
            WHERE email_id = ?`,
      args: ["msg-pending-trash"],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', 'queued', ?)`,
      args: [
        "user-1",
        "gmail-work",
        "msg-pending-trash",
        "email_triage:user-1:gmail-work:msg-pending-trash",
      ],
    });

    await markProviderRemovedFromActiveSnapshots(
      "user-1",
      "gmail-work",
      "msg-pending-trash",
      "trashed",
      {
        dbClient,
        now: new Date("2026-05-03T16:20:00.000Z"),
      },
    );

    const rows = await dbClient.execute({
      sql: `SELECT i.provider_removed_at,
                   t.provider_state,
                   j.status,
                   j.completed_at,
                   j.last_error
            FROM ea_briefing_snapshot_items i
            JOIN ea_email_triage t ON t.id = i.triage_id
            JOIN ea_triage_jobs j ON j.email_id = i.email_id
            WHERE i.id = ?`,
      args: [itemId],
    });

    expect(rows.rows).toEqual([
      {
        provider_removed_at: "2026-05-03T16:20:00.000Z",
        provider_state: "trashed",
        status: "complete",
        completed_at: "2026-05-03T16:20:00.000Z",
        last_error: "Skipped pending triage; provider state trashed",
      },
    ]);
  });

  it("logs source timings while syncing the active snapshot", async () => {
    const dbClient = await createMigratedDb();
    const logger = vi.spyOn(console, "log").mockImplementation(() => {});
    let messages: unknown[] = [];

    try {
      await syncActiveSnapshot("user-1", {
        dbClient,
        loadUserConfigFn: vi.fn(async () => syncUserConfig()),
        fetchAllEmailsFn: vi.fn(async () => []),
        indexEmailsFn: vi.fn(),
        enqueueEmailTriageForEmailsFn: vi.fn(),
        processNextEmailTriageJobFn: vi.fn(async () => ({ processed: false })),
        now: new Date("2026-05-03T16:15:00.000Z"),
      });
      messages = logger.mock.calls.map(([message]) => message);
    } finally {
      logger.mockRestore();
    }

    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('"event":"snapshot-sync-source","source":"config"'),
      expect.stringContaining('"event":"snapshot-sync-source","source":"emailFetch"'),
      expect.stringContaining('"event":"snapshot-sync-source","source":"triageLoop"'),
      expect.stringContaining('"event":"snapshot-sync-source","source":"snapshotView"'),
    ]));
  });

  it("shares one active snapshot sync when concurrent requests target the same user", async () => {
    const dbClient = await createMigratedDb();
    let releaseConfig: (() => void) | undefined;
    const loadUserConfigFn = vi.fn(() => new Promise<UserConfig>((resolve) => {
      releaseConfig = () => resolve(syncUserConfig());
    }));
    const fetchAllEmailsFn = vi.fn(async () => []);
    const indexEmailsFn = vi.fn();
    const enqueueEmailTriageForEmailsFn = vi.fn();
    const processNextEmailTriageJobFn = vi.fn(async () => ({ processed: false }));

    const options = {
      dbClient,
      loadUserConfigFn,
      fetchAllEmailsFn,
      indexEmailsFn,
      enqueueEmailTriageForEmailsFn,
      processNextEmailTriageJobFn,
      now: new Date("2026-05-03T16:15:00.000Z"),
    };

    const first = syncActiveSnapshot("user-1", options);
    const second = syncActiveSnapshot("user-1", options);
    expect(loadUserConfigFn).toHaveBeenCalledTimes(1);

    releaseConfig!();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(fetchAllEmailsFn).toHaveBeenCalledTimes(1);
    expect(processNextEmailTriageJobFn).toHaveBeenCalledTimes(1);
  });

  it("stops carrying an unhandled needs_attention item after CARRYOVER_MAX_DEPTH boundaries", async () => {
    const dbClient = await createMigratedDb();
    const seedNow = new Date("2026-05-03T15:00:00.000Z");
    await seedSnapshotItem(dbClient, {
      emailId: "msg-stale",
      lane: "needs_attention",
      now: seedNow,
    });

    const carryoverCountFor = async (emailId: string) => {
      const rows = await dbClient.execute({
        sql: `SELECT carryover_count
              FROM ea_briefing_snapshot_items i
              JOIN ea_briefing_snapshots s ON s.id = i.snapshot_id AND s.status = 'active'
              WHERE i.email_id = ?`,
        args: [emailId],
      });
      return rows.rows.length ? Number(rows.rows[0]!.carryover_count) : null;
    };

    for (let carry = 1; carry <= CARRYOVER_MAX_DEPTH + 2; carry++) {
      // Advance one daily boundary per carry via real date arithmetic, so the loop
      // stays correct even if CARRYOVER_MAX_DEPTH is tuned past a month boundary
      // (string-built "2026-05-${3+carry}" dates would overflow day 31).
      const now = new Date(seedNow.getTime() + carry * 24 * 60 * 60 * 1000);
      await advanceSnapshotBoundary("user-1", { dbClient, now });
      const view = await getActiveSnapshotView("user-1", { dbClient, now });

      if (carry <= CARRYOVER_MAX_DEPTH) {
        expect(view.carryover.map((item) => item.email_id)).toEqual(["msg-stale"]);
        expect(await carryoverCountFor("msg-stale")).toBe(carry);
      } else {
        expect(view.carryover.map((item) => item.email_id)).toEqual([]);
        expect(await carryoverCountFor("msg-stale")).toBeNull();
      }
    }
  });

  it("excludes handled and dismissed items from carryover regardless of depth", async () => {
    const dbClient = await createMigratedDb();
    const previousNow = new Date("2026-05-03T15:00:00.000Z");
    const handled = await seedSnapshotItem(dbClient, {
      emailId: "msg-handled",
      lane: "needs_attention",
      now: previousNow,
    });
    const dismissed = await seedSnapshotItem(dbClient, {
      emailId: "msg-dismissed",
      lane: "needs_attention",
      now: previousNow,
    });
    await dbClient.execute({
      sql: "UPDATE ea_email_triage SET handled_at = ? WHERE id = ?",
      args: ["2026-05-03T18:00:00.000Z", handled.triageId],
    });
    await dbClient.execute({
      sql: "UPDATE ea_briefing_snapshot_items SET dismissed_from_today_at = ? WHERE id = ?",
      args: ["2026-05-03T18:00:00.000Z", dismissed.itemId],
    });

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });
    expect(view.carryover.map((item) => item.email_id)).toEqual([]);
  });

  it("keeps carrying a queued arrival-grace row under the depth bound", async () => {
    const dbClient = await createMigratedDb();
    const previousNow = new Date("2026-05-03T18:00:00.000Z");
    const previous = await getOrCreateActiveSnapshot("user-1", { dbClient, now: previousNow });
    const triageResult = await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source)
            VALUES ('user-1', 'gmail-work', 'msg-queued-carry', 'pending', 'arrival_grace')
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
            VALUES (?, ?, 'user-1', 'gmail-work', 'msg-queued-carry',
                    'queued', 'Queued for triage.', 'Waiting briefly before triage.',
                    'normal', 'uncategorized', 'Queued carry',
                    'arrival_grace', '2026-05-03T18:03:00.000Z')`,
      args: [previous.id, triageId],
    });

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });
    expect(view.carryover.map((item) => ({
      email_id: item.email_id,
      lane: item.lane,
      is_carryover: item.is_carryover,
    }))).toEqual([
      { email_id: "msg-queued-carry", lane: "queued", is_carryover: true },
    ]);
  });

  it("reports how many items aged out of carryover only because of the depth bound", async () => {
    const dbClient = await createMigratedDb();
    const previous = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    // msg-aged: at the bound -> excluded ONLY by the bound (counts)
    // msg-live: below the bound -> still carries (does not count)
    // msg-handled: at the bound BUT handled -> excluded for another reason (does not count)
    for (const [emailId, carryoverCount, handledAt] of ([
      ["msg-aged", CARRYOVER_MAX_DEPTH, null],
      ["msg-live", CARRYOVER_MAX_DEPTH - 1, null],
      ["msg-handled", CARRYOVER_MAX_DEPTH, "2026-05-03T18:00:00.000Z"],
    ] as const)) {
      const triageResult = await dbClient.execute({
        sql: `INSERT INTO ea_email_triage
                (user_id, account_id, email_id, lane, triage_status, handled_at)
              VALUES ('user-1', 'gmail-work', ?, 'needs_attention', 'complete', ?)
              RETURNING id`,
        args: [emailId, handledAt],
      });
      await dbClient.execute({
        sql: `INSERT INTO ea_briefing_snapshot_items
                (snapshot_id, triage_id, user_id, account_id, email_id,
                 lane_at_snapshot, carryover_count, handled_at)
              VALUES (?, ?, 'user-1', 'gmail-work', ?, 'needs_attention', ?, ?)`,
        args: [previous.id, Number(triageResult.rows[0]!.id), emailId, carryoverCount, handledAt],
      });
    }

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    expect(view.carryover.map((item) => item.email_id)).toEqual(["msg-live"]);
    expect(view.carryoverAgedOut).toBe(1);
  });

  it("reports zero aged-out carryover for a historical snapshot view", async () => {
    const dbClient = await createMigratedDb();
    const snapshot = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    const view = await getSnapshotViewById("user-1", snapshot.id, { dbClient });
    expect(view.carryoverAgedOut).toBe(0);
  });

  it("includes an empty pinned array on the active snapshot view when no pins exist", async () => {
    const dbClient = await createMigratedDb();
    await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    expect(view.pinned).toEqual([]);
  });

  it("hydrates a pinned entry on the active snapshot view for an email outside today's snapshot", async () => {
    const dbClient = await createMigratedDb();
    await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });
    await pinWithSnapshot("user-1", "msg-not-in-snapshot", { subject: "Pinned elsewhere" }, { dbClient });

    const view = await getActiveSnapshotView("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    expect(view.pinned).toHaveLength(1);
    expect(view.pinned[0]).toMatchObject({
      uid: "msg-not-in-snapshot",
      subject: "Pinned elsewhere",
    });
  });

  it("keeps the frozen snapshot view free of a pinned key", async () => {
    const dbClient = await createMigratedDb();
    const snapshot = await getOrCreateActiveSnapshot("user-1", {
      dbClient,
      now: new Date("2026-05-03T15:00:00.000Z"),
    });
    await pinWithSnapshot("user-1", "msg-not-in-snapshot", { subject: "Pinned elsewhere" }, { dbClient });

    const view = await getSnapshotViewById("user-1", snapshot.id, { dbClient });

    expect((view as unknown as Record<string, unknown>).pinned).toBeUndefined();
  });
});
