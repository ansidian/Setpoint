import { describe, expect, it } from "vitest";
import {
  attachArrivalGraceEmailToActiveSnapshot,
  restorePendingTriageEligibilityForEmail,
} from "./snapshot-triage-attachment.js";
import {
  getOrCreateActiveSnapshot,
  settleReadArrivalGraceRows,
} from "./snapshot-service.js";
import { createMigratedDb } from "./snapshot-test-fixtures.js";

describe("snapshot triage attachment", () => {
  it("does not let arrival-grace attach overwrite a read settle that wins the race", async () => {
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
    const triageId = Number(triageResult.rows[0].id);
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

    let settledDuringAttach = false;
    const racingDbClient = {
      async execute(statement) {
        const sql = typeof statement === "string" ? statement : statement.sql;
        if (!settledDuringAttach && sql.includes("INSERT INTO ea_briefing_snapshot_items")) {
          settledDuringAttach = true;
          await settleReadArrivalGraceRows("user-1", { dbClient, now });
        }
        return dbClient.execute(statement);
      },
      async batch(statements) {
        return dbClient.batch(statements);
      },
    };

    const attachResult = await attachArrivalGraceEmailToActiveSnapshot("user-1", "gmail-work", {
      uid: "msg-arrival-read",
      subject: "Read in grace",
      from_name: "Reader",
      from_address: "reader@example.com",
      email_date: "2026-05-03T15:58:00.000Z",
      account_label: "Work",
      account_email: "work@example.com",
    }, { dbClient: racingDbClient, now });

    const rows = await dbClient.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   i.lane_at_snapshot,
                   i.source
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.email_id = t.email_id
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            WHERE t.email_id = ?`,
      args: ["msg-arrival-read"],
    });
    expect(settledDuringAttach).toBe(true);
    expect(attachResult).toBeNull();
    expect(rows.rows).toEqual([
      {
        triage_status: "skipped",
        triage_source: "arrival_grace_read",
        job_status: "complete",
        lane_at_snapshot: "untriaged_read",
        source: "arrival_grace_read",
      },
    ]);
  });

  it("restores pending triage eligibility for undo after pending dismissal", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-03T16:00:00.000Z");
    const snapshot = await getOrCreateActiveSnapshot("user-1", { dbClient, now });
    const triageResult = await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source, dismissed_at)
            VALUES (?, ?, ?, 'skipped', 'user_dismissed_pending', ?)
            RETURNING id`,
      args: ["user-1", "gmail-work", "msg-undo-pending", "2026-05-03T16:05:00.000Z"],
    });
    const triageId = Number(triageResult.rows[0].id);
    await dbClient.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, category_at_snapshot, subject_at_snapshot,
               dismissed_from_today_at)
            VALUES (?, ?, ?, ?, ?, 'needs_attention', 'Pending', 'Review',
                    'normal', 'uncategorized', 'Pending undo', ?)`,
      args: [
        snapshot.id,
        triageId,
        "user-1",
        "gmail-work",
        "msg-undo-pending",
        "2026-05-03T16:05:00.000Z",
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, completed_at, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', 'complete', ?, ?)`,
      args: [
        "user-1",
        "gmail-work",
        "msg-undo-pending",
        "2026-05-03T16:05:00.000Z",
        "email_triage:user-1:gmail-work:msg-undo-pending",
      ],
    });

    const result = await restorePendingTriageEligibilityForEmail(
      "user-1",
      "gmail-work",
      "msg-undo-pending",
      { dbClient },
    );

    expect(result).toEqual({ updated: 1, itemsRestored: 1 });
    const rows = await dbClient.execute({
      sql: `SELECT t.dismissed_at,
                   t.triage_status,
                   t.triage_source,
                   i.dismissed_from_today_at,
                   j.status,
                   j.completed_at,
                   j.scheduled_for,
                   j.last_error
            FROM ea_email_triage t
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            JOIN ea_triage_jobs j ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            WHERE t.email_id = ?`,
      args: ["msg-undo-pending"],
    });
    expect(rows.rows).toEqual([
      {
        dismissed_at: null,
        triage_status: "pending",
        triage_source: "undo_restored_pending",
        dismissed_from_today_at: null,
        status: "queued",
        completed_at: null,
        scheduled_for: null,
        last_error: "",
      },
    ]);
  });
});
