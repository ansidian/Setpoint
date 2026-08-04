import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import { processNextEmailTriageJob } from "./triage-worker.ts";
import {
  clearCurrentDashboardEventSubscribers,
  subscribeCurrentDashboardEvents,
} from "../dashboard/current-events.ts";

let events: Record<string, unknown>[];
let unsubscribe: () => void;

describe("email triage worker pending skips", () => {
  beforeEach(() => {
    clearCurrentDashboardEventSubscribers();
    events = [];
    unsubscribe = subscribeCurrentDashboardEvents("user-1", (event) => events.push(event));
  });

  afterEach(() => unsubscribe());

  it("skips provider-unavailable pending rows without calling the model", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Pending but trashed",
      body_snippet: "This row was removed before triage.",
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET provider_state = 'trashed'
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:36:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      skipped: true,
      source: "provider_unavailable_skip",
      model_calls: [],
    });
    const jobs = await dbClient.execute({
      sql: "SELECT status, completed_at, last_error FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "complete",
      completed_at: "2026-05-03T12:36:00.000Z",
      last_error: "Skipped pending triage; provider state trashed",
    });

    const triage = await dbClient.execute({
      sql: `SELECT lane,
                   triage_status,
                   triage_source,
                   provider_state,
                   last_triaged_at,
                   model_usage_json,
                   cheap_model_result_json,
                   strong_model_result_json
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(triage.rows[0]).toMatchObject({
      lane: "needs_attention",
      triage_status: "pending",
      triage_source: "unknown",
      provider_state: "trashed",
      last_triaged_at: null,
      model_usage_json: "{}",
      cheap_model_result_json: null,
      strong_model_result_json: null,
    });
    const snapshots = await dbClient.execute({
      sql: "SELECT * FROM ea_briefing_snapshot_items WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(snapshots.rows).toHaveLength(0);
    // This branch does not change the rendered snapshot, so it must not force a
    // dashboard refetch/re-render (gate the triage SSE storm).
    expect(events).toEqual([]);
    });

  it("skips user-dismissed pending rows without calling the model", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Pending but dismissed",
      body_snippet: "The user removed this from the workflow.",
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET dismissed_at = '2026-05-03T12:35:00.000Z',
                triage_source = 'user_dismissed_pending'
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:37:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      skipped: true,
      source: "user_dismissed_pending_skip",
      model_calls: [],
    });
    const jobs = await dbClient.execute({
      sql: "SELECT status, completed_at, last_error FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "complete",
      completed_at: "2026-05-03T12:37:00.000Z",
      last_error: "Skipped pending triage; user dismissed row",
    });

    const triage = await dbClient.execute({
      sql: `SELECT triage_status, triage_source, dismissed_at, last_triaged_at
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(triage.rows[0]).toMatchObject({
      triage_status: "pending",
      triage_source: "user_dismissed_pending",
      dismissed_at: "2026-05-03T12:35:00.000Z",
      last_triaged_at: null,
    });
    const snapshots = await dbClient.execute({
      sql: "SELECT * FROM ea_briefing_snapshot_items WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(snapshots.rows).toHaveLength(0);
    // This branch does not change the rendered snapshot, so it must not force a
    // dashboard refetch/re-render (gate the triage SSE storm).
    expect(events).toEqual([]);
    });

  it("defers snoozed pending rows without calling the model", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Pending but snoozed",
      body_snippet: "The user deferred this row.",
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, status)
            VALUES (?, ?, ?, 'snoozed')`,
      args: ["user-1", "msg-1", Date.parse("2026-05-04T17:46:40.000Z")],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:38:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      delayed: true,
      source: "snoozed_pending",
      model_calls: [],
      scheduled_for: "2026-05-04T17:46:40.000Z",
    });
    const jobs = await dbClient.execute({
      sql: "SELECT status, locked_at, scheduled_for, last_error FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "queued",
      locked_at: null,
      scheduled_for: "2026-05-04T17:46:40.000Z",
      last_error: "Deferred pending triage while snoozed",
    });

    const triage = await dbClient.execute({
      sql: `SELECT triage_status, triage_source, last_triaged_at
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(triage.rows[0]).toMatchObject({
      triage_status: "pending",
      triage_source: "unknown",
      last_triaged_at: null,
    });
    const snapshots = await dbClient.execute({
      sql: "SELECT * FROM ea_briefing_snapshot_items WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(snapshots.rows).toHaveLength(0);
    // This branch does not change the rendered snapshot, so it must not force a
    // dashboard refetch/re-render (gate the triage SSE storm).
    expect(events).toEqual([]);
    });
});
