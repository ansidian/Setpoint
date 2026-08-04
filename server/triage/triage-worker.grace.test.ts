import { describe, expect, it, vi } from "vitest";
import { clearCurrentDashboardEventSubscribers, subscribeCurrentDashboardEvents } from "../dashboard/current-events.ts";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import { processNextEmailTriageJob } from "./triage-worker.ts";

describe("email triage worker grace flows", () => {
  it("delays weak-risk security once and exposes pending snapshot metadata", async () => {
    clearCurrentDashboardEventSubscribers();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Account Security",
      from_address: "security@example.com",
      subject: "New sign-in to your account",
      body_snippet: "We noticed a sign-in from Chrome on macOS.",
      body_text: "We noticed a sign-in from Chrome on macOS. If this was you, no action is needed.",
    });
    const events: Record<string, unknown>[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event: Record<string, unknown>) => events.push(event));
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      delayed: true,
      source: "weak_security_grace",
      model_calls: [],
    });
    const jobs = await dbClient.execute({
      sql: `SELECT status, attempts, locked_at, scheduled_for, completed_at
            FROM ea_triage_jobs
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      locked_at: null,
      scheduled_for: "2026-05-03T12:10:00.000Z",
      completed_at: null,
    });

    const triage = await dbClient.execute({
      sql: `SELECT triage_status, triage_source, decision_metadata_json
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(triage.rows[0]).toMatchObject({
      triage_status: "pending",
      triage_source: "weak_security_grace",
    });
    expect(JSON.parse(String(triage.rows[0]!.decision_metadata_json))).toMatchObject({
      preflight: {
        action: "grace",
        reasonCode: "weak_security_grace",
      },
    });

    const items = await dbClient.execute({
      sql: `SELECT lane_at_snapshot, source, source_at, summary_at_snapshot
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(items.rows[0]).toMatchObject({
      lane_at_snapshot: "needs_attention",
      source: "pending_security_grace",
      source_at: "2026-05-03T12:10:00.000Z",
      summary_at_snapshot: "Security triage pending.",
    });
    expect(events).toEqual([
      expect.objectContaining({
        source: "email_triage",
        reason: "weak_security_grace_delayed",
        details: {
          triggerType: "weak_security_grace",
          eventKey: "email_triage:gmail-work:msg-1:weak_security_grace_delayed",
          emailId: "msg-1",
          lane: "needs_attention",
          triageSource: "weak_security_grace",
          reason: "weak_security_grace_delayed",
        },
      }),
    ]);
    unsubscribe();
    await dbClient.close();
    });

  it("defers read arrival-grace rows without model calls when the worker reaches them", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient);
    await dbClient.execute({
      sql: "UPDATE ea_email_index SET read = 1 WHERE uid = ?",
      args: ["msg-1"],
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET triage_source = 'arrival_grace',
                triage_status = 'pending'
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    await dbClient.execute({
      sql: "UPDATE ea_triage_jobs SET scheduled_for = ? WHERE email_id = ?",
      args: ["2026-05-03T12:03:00.000Z", "msg-1"],
    });
    const snapshot = await dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshots
              (user_id, start_at, end_at, timezone, status)
            VALUES ('user-1', '2026-05-03T07:00:00.000Z', '2026-05-04T07:00:00.000Z',
                    'America/Los_Angeles', 'active')
            RETURNING id`,
      args: [],
    });
    const triage = await dbClient.execute({
      sql: "SELECT id FROM ea_email_triage WHERE email_id = ?",
      args: ["msg-1"],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, category_at_snapshot, subject_at_snapshot,
               source, source_at)
            VALUES (?, ?, 'user-1', 'gmail-work', 'msg-1',
                    'queued', 'Queued for triage.', 'Waiting briefly before triage.',
                    'normal', 'uncategorized', 'Fresh arrival',
                    'arrival_grace', '2026-05-03T12:03:00.000Z')`,
      args: [Number(snapshot.rows[0]!.id), Number(triage.rows[0]!.id)],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:03:30.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      skipped: true,
      source: "arrival_grace_read_deferred",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   t.last_triaged_at,
                   j.status AS job_status,
                   j.completed_at,
                   j.scheduled_for,
                   i.lane_at_snapshot,
                   i.source
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            WHERE t.email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows).toEqual([
      {
        triage_status: "pending",
        triage_source: "arrival_grace",
        last_triaged_at: null,
        job_status: "queued",
        completed_at: null,
        scheduled_for: "2026-05-03T12:33:30.000Z",
        lane_at_snapshot: "queued",
        source: "arrival_grace",
      },
    ]);
    await dbClient.close();
    });

  it("waits until arrival grace expires before calling the triage model", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "University Billing",
      from_address: "billing@school.example",
      subject: "Payment due for tuition",
      body_snippet: "Your payment due date is May 8.",
      body_text: "Tuition balance $450.00 is due May 8.",
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET triage_source = 'arrival_grace',
                triage_status = 'pending'
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    await dbClient.execute({
      sql: "UPDATE ea_triage_jobs SET scheduled_for = ? WHERE email_id = ?",
      args: ["2026-05-03T12:03:00.000Z", "msg-1"],
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "needs_attention",
          category: "finance",
          urgency: "high",
          escalation_badge: "High Risk",
          summary: "Tuition payment is due soon.",
          action: "Review payment",
          deadline_at: "2026-05-08T16:00:00.000Z",
          confidence: 0.88,
        },
        usage: { input_tokens: 120, output_tokens: 40 },
        estimated_cost_usd: 0.004,
        latency_ms: 600,
        tier,
      })),
    };

    await expect(processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:02:59.000Z"),
    })).resolves.toEqual({ processed: false });
    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:03:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "needs_attention",
      model_calls: ["strong"],
    });
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   j.scheduled_for
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.email_id = t.email_id
            WHERE t.email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      triage_status: "complete",
      triage_source: "strong_model",
      job_status: "complete",
      scheduled_for: null,
    });
    await dbClient.close();
    });

  it("finalizes read weak-security grace rows as FYI on the second run without model calls", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Account Security",
      from_address: "security@example.com",
      subject: "New sign-in to your account",
      body_snippet: "We noticed a sign-in from Chrome on macOS.",
      body_text: "We noticed a sign-in from Chrome on macOS. If this was you, no action is needed.",
    });
    const modelClient = { classify: vi.fn() };

    await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });
    await dbClient.execute({
      sql: "UPDATE ea_email_index SET read = 1 WHERE uid = ?",
      args: ["msg-1"],
    });

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:11:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "fyi",
      source: "weak_security_grace_read",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: `SELECT t.lane,
                   t.triage_status,
                   t.triage_source,
                   t.last_triaged_at,
                   t.decision_metadata_json,
                   j.status AS job_status,
                   j.completed_at,
                   j.scheduled_for
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.email_id = t.email_id
            WHERE t.email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      triage_status: "complete",
      triage_source: "weak_security_grace_read",
      last_triaged_at: "2026-05-03T12:11:00.000Z",
      job_status: "complete",
      completed_at: "2026-05-03T12:11:00.000Z",
      scheduled_for: null,
    });
    expect(JSON.parse(String(rows.rows[0]!.decision_metadata_json))).toMatchObject({
      weakSecurityGrace: {
        outcome: "read_in_inbox",
        modelSaved: true,
      },
    });

    const items = await dbClient.execute({
      sql: `SELECT lane_at_snapshot,
                   summary_at_snapshot,
                   action_at_snapshot,
                   urgency_at_snapshot,
                   category_at_snapshot,
                   source,
                   source_at
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(items.rows).toEqual([
      {
        lane_at_snapshot: "fyi",
        summary_at_snapshot: "Security notification was read during the grace window.",
        action_at_snapshot: "No action needed.",
        urgency_at_snapshot: "low",
        category_at_snapshot: "security",
        source: null,
        source_at: null,
      },
    ]);
    await dbClient.close();
    });

  it("completes unavailable weak-security grace rows without finalizing stale snapshot state", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Account Security",
      from_address: "security@example.com",
      subject: "New sign-in to your account",
      body_snippet: "We noticed a sign-in from Chrome on macOS.",
      body_text: "We noticed a sign-in from Chrome on macOS. If this was you, no action is needed.",
    });
    const modelClient = { classify: vi.fn() };
    clearCurrentDashboardEventSubscribers();
    const events: Record<string, unknown>[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event: Record<string, unknown>) => events.push(event));

    await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET provider_state = 'trashed'
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    // The first run delayed the grace (a legitimate publish); the skip below must add none.
    const eventCountBeforeSkip = events.length;

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:11:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      skipped: true,
      source: "weak_security_grace_skip",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   t.last_triaged_at,
                   j.status AS job_status,
                   j.completed_at,
                   j.last_error
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.email_id = t.email_id
            WHERE t.email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      triage_status: "pending",
      triage_source: "weak_security_grace",
      last_triaged_at: null,
      job_status: "complete",
      completed_at: "2026-05-03T12:11:00.000Z",
      last_error: "Skipped weak-security grace; provider state trashed",
    });

    const items = await dbClient.execute({
      sql: `SELECT lane_at_snapshot, source, source_at
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(items.rows).toEqual([
      {
        lane_at_snapshot: "needs_attention",
        source: "pending_security_grace",
        source_at: "2026-05-03T12:10:00.000Z",
      },
    ]);
    // The weak-security skip leaves the snapshot lane unchanged, so it must not
    // publish a dashboard-current event (would force a redundant /current re-render).
    expect(events.length).toBe(eventCountBeforeSkip);
    unsubscribe();
    await dbClient.close();
    });

  it("classifies unread weak-security grace rows on the second run without delaying again", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Account Security",
      from_address: "security@example.com",
      subject: "New sign-in to your account",
      body_snippet: "We noticed a sign-in from Chrome on macOS.",
      body_text: "We noticed a sign-in from Chrome on macOS. If this was you, no action is needed.",
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "fyi",
          category: "security",
          urgency: "normal",
          escalation_badge: null,
          summary: "Routine sign-in confirmation.",
          action: "No action needed.",
          deadline_at: null,
          confidence: 0.9,
          bill_candidate: null,
        },
        usage: { input_tokens: 80, output_tokens: 20 },
        tier,
      })),
    };

    await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:11:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "fyi",
      source: "cheap_model",
      model_calls: ["cheap"],
    });
    const jobs = await dbClient.execute({
      sql: "SELECT status, attempts, scheduled_for FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "complete",
      attempts: 2,
      scheduled_for: null,
    });
    });

  it("leaves read arrival-grace rows queued when triage mode is paused", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient);
    await dbClient.batch([
      {
        sql: "UPDATE ea_settings SET email_triage_mode = 'paused' WHERE user_id = ?",
        args: ["user-1"],
      },
      {
        sql: `UPDATE ea_email_index
              SET read = 1
              WHERE uid = ?`,
        args: ["msg-1"],
      },
      {
        sql: `UPDATE ea_email_triage
              SET triage_source = 'arrival_grace',
                  triage_status = 'pending'
              WHERE email_id = ?`,
        args: ["msg-1"],
      },
      {
        sql: "UPDATE ea_triage_jobs SET scheduled_for = ? WHERE email_id = ?",
        args: ["2026-05-03T12:03:00.000Z", "msg-1"],
      },
    ]);
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:03:30.000Z"),
    });

    expect(result).toMatchObject({
      processed: false,
      paused: true,
    });
    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status, t.triage_source, j.status, j.completed_at
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.email_id = t.email_id
            WHERE t.email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows).toEqual([
      {
        triage_status: "pending",
        triage_source: "arrival_grace",
        status: "queued",
        completed_at: null,
      },
    ]);
    });
});
