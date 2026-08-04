import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createEmailIndexTestDb, seedEmailAccount } from "./test-utils/email-index-db.ts";

describe("Gmail triage queue persistence", () => {
  let db: Client | null = null;

  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it("persists account-scoped arrival-grace work and its payload through the enqueue facade", async () => {
    db = await createEmailIndexTestDb();
    await seedEmailAccount(db, {
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
      label: "Work",
    });
    await seedEmailAccount(db, {
      id: "gmail-personal",
      user_id: "user-1",
      email: "personal@example.com",
      label: "Personal",
    });
    const now = new Date("2026-05-03T12:00:00.000Z");
    const deadline = "2026-05-03T12:00:30.000Z";
    const { enqueueEmailTriageForEmails } = await import("./gmail-sync.ts");

    await expect(enqueueEmailTriageForEmails("user-1", [
      { uid: "shared-message-id", account_id: "gmail-work", subject: "Work message" },
      { uid: "shared-message-id", account_id: "gmail-personal", subject: "Personal message" },
    ], {
      dbClient: db,
      now,
      requestEmailTriageDrainAtFn: () => undefined,
    })).resolves.toEqual({ queued: 2 });

    const triage = await db.execute({
      sql: `SELECT account_id, email_id, triage_status, triage_source
            FROM ea_email_triage
            ORDER BY account_id`,
      args: [],
    });
    expect(triage.rows).toEqual([
      {
        account_id: "gmail-personal",
        email_id: "shared-message-id",
        triage_status: "pending",
        triage_source: "arrival_grace",
      },
      {
        account_id: "gmail-work",
        email_id: "shared-message-id",
        triage_status: "pending",
        triage_source: "arrival_grace",
      },
    ]);

    const jobs = await db.execute({
      sql: `SELECT account_id, email_id, job_type, status, idempotency_key,
                   priority, scheduled_for, payload_json
            FROM ea_triage_jobs
            WHERE job_type = 'email_triage'
            ORDER BY account_id`,
      args: [],
    });
    expect(jobs.rows.map((row) => ({
      account_id: row.account_id,
      email_id: row.email_id,
      job_type: row.job_type,
      status: row.status,
      idempotency_key: row.idempotency_key,
      priority: row.priority,
      scheduled_for: row.scheduled_for,
      payload: JSON.parse(String(row.payload_json)),
    }))).toEqual([
      {
        account_id: "gmail-personal",
        email_id: "shared-message-id",
        job_type: "email_triage",
        status: "queued",
        idempotency_key: "email_triage:user-1:gmail-personal:shared-message-id",
        priority: 2,
        scheduled_for: deadline,
        payload: {
          uid: "shared-message-id",
          subject: "Personal message",
          arrivalGrace: true,
          queuedAt: now.toISOString(),
          graceDeadline: deadline,
        },
      },
      {
        account_id: "gmail-work",
        email_id: "shared-message-id",
        job_type: "email_triage",
        status: "queued",
        idempotency_key: "email_triage:user-1:gmail-work:shared-message-id",
        priority: 2,
        scheduled_for: deadline,
        payload: {
          uid: "shared-message-id",
          subject: "Work message",
          arrivalGrace: true,
          queuedAt: now.toISOString(),
          graceDeadline: deadline,
        },
      },
    ]);

    const snapshotItems = await db.execute({
      sql: `SELECT account_id, email_id, lane_at_snapshot, source, source_at
            FROM ea_briefing_snapshot_items
            ORDER BY account_id`,
      args: [],
    });
    expect(snapshotItems.rows).toEqual([
      {
        account_id: "gmail-personal",
        email_id: "shared-message-id",
        lane_at_snapshot: "queued",
        source: "arrival_grace",
        source_at: deadline,
      },
      {
        account_id: "gmail-work",
        email_id: "shared-message-id",
        lane_at_snapshot: "queued",
        source: "arrival_grace",
        source_at: deadline,
      },
    ]);
  });

  it("deduplicates repeated arrival work without replacing the first durable payload or deadline", async () => {
    db = await createEmailIndexTestDb();
    const { enqueueEmailTriageForEmails } = await import("./gmail-sync.ts");
    const firstNow = new Date("2026-05-03T12:00:00.000Z");
    const secondNow = new Date("2026-05-03T12:00:10.000Z");

    await enqueueEmailTriageForEmails("user-1", [
      { uid: "message-1", account_id: "gmail-work", subject: "Original subject" },
    ], {
      dbClient: db,
      now: firstNow,
      requestEmailTriageDrainAtFn: () => undefined,
    });
    await enqueueEmailTriageForEmails("user-1", [
      { uid: "message-1", account_id: "gmail-work", subject: "Replayed subject" },
    ], {
      dbClient: db,
      now: secondNow,
      requestEmailTriageDrainAtFn: () => undefined,
    });

    const rows = await db.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   j.idempotency_key,
                   j.scheduled_for,
                   j.payload_json
            FROM ea_email_triage t
            JOIN ea_triage_jobs j
              ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            WHERE t.user_id = ?
              AND t.account_id = ?
              AND t.email_id = ?`,
      args: ["user-1", "gmail-work", "message-1"],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      triage_status: "pending",
      triage_source: "arrival_grace",
      job_status: "queued",
      idempotency_key: "email_triage:user-1:gmail-work:message-1",
      scheduled_for: "2026-05-03T12:00:30.000Z",
    });
    expect(JSON.parse(String(rows.rows[0]!.payload_json))).toEqual({
      uid: "message-1",
      subject: "Original subject",
      arrivalGrace: true,
      queuedAt: firstNow.toISOString(),
      graceDeadline: "2026-05-03T12:00:30.000Z",
    });

    const counts = await db.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM ea_email_triage
               WHERE user_id = ? AND account_id = ? AND email_id = ?) AS triage_count,
              (SELECT COUNT(*) FROM ea_triage_jobs
               WHERE user_id = ? AND account_id = ? AND email_id = ?
                 AND job_type = 'email_triage') AS job_count`,
      args: ["user-1", "gmail-work", "message-1", "user-1", "gmail-work", "message-1"],
    });
    expect(counts.rows[0]).toEqual({ triage_count: 1, job_count: 1 });
  });

  it("persists non-grace work without arrival metadata or a classification deadline", async () => {
    db = await createEmailIndexTestDb();
    const { enqueueEmailTriageForEmails } = await import("./gmail-sync.ts");

    await enqueueEmailTriageForEmails("user-1", [
      { uid: "recovered-message", account_id: "gmail-work", subject: "Recovered message" },
    ], {
      dbClient: db,
      arrivalGrace: false,
      now: new Date("2026-05-03T12:00:00.000Z"),
      requestEmailTriageDrainAtFn: () => undefined,
    });

    const rows = await db.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   j.scheduled_for,
                   j.payload_json
            FROM ea_email_triage t
            JOIN ea_triage_jobs j
              ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            WHERE t.user_id = ?
              AND t.account_id = ?
              AND t.email_id = ?`,
      args: ["user-1", "gmail-work", "recovered-message"],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      triage_status: "pending",
      triage_source: "unknown",
      job_status: "queued",
      scheduled_for: null,
    });
    expect(JSON.parse(String(rows.rows[0]!.payload_json))).toEqual({
      uid: "recovered-message",
      subject: "Recovered message",
    });

    const snapshots = await db.execute({
      sql: `SELECT id
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["recovered-message"],
    });
    expect(snapshots.rows).toEqual([]);
  });
});
