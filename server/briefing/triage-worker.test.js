import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { __resetCurrentDashboardEventsForTests, subscribeCurrentDashboardEvents } from "../dashboard/current-events.js";
import { processNextEmailTriageJob, recoverStaleRunningTriageJobs } from "./triage-worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const triageMigrationSql = readFileSync(
  join(__dirname, "../db/migrations/030_triage_snapshots.sql"),
  "utf8",
);
const sourceMetadataMigrationSql = readFileSync(
  join(__dirname, "../db/migrations/036_snapshot_item_source_metadata.sql"),
  "utf8",
);
const decisionMetadataMigrationSql = readFileSync(
  join(__dirname, "../db/migrations/043_email_triage_decision_metadata.sql"),
  "utf8",
);

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_email_index (
      uid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_label TEXT NOT NULL DEFAULT '',
      account_email TEXT NOT NULL DEFAULT '',
      account_color TEXT DEFAULT '#818cf8',
      account_icon TEXT DEFAULT 'Mail',
      from_name TEXT NOT NULL DEFAULT '',
      from_address TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body_snippet TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      email_date TEXT NOT NULL DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      email_ai_provider TEXT DEFAULT 'anthropic',
      email_ai_model TEXT DEFAULT NULL,
      claude_model TEXT DEFAULT NULL,
      bill_extract_provider TEXT DEFAULT 'anthropic',
      bill_extract_model TEXT DEFAULT 'claude-haiku-4-5',
      email_triage_mode TEXT DEFAULT 'auto',
      email_interests_json TEXT
    );
  `);
  await db.executeMultiple(triageMigrationSql);
  await db.executeMultiple(sourceMetadataMigrationSql);
  await db.executeMultiple(decisionMetadataMigrationSql);
  return db;
}

async function queueEmail(dbClient, email = {}) {
  const row = {
    uid: "msg-1",
    user_id: "user-1",
    account_id: "gmail-work",
    account_label: "Work",
    account_email: "work@example.com",
    from_name: "Example Deals",
    from_address: "deals@example.com",
    subject: "Weekend sale - 40% off",
    body_snippet: "Unsubscribe any time.",
    body_text: "Sale ends soon. Unsubscribe any time.",
    email_date: "2026-05-03T12:00:00.000Z",
    ...email,
  };
  await dbClient.batch([
    {
      sql: `INSERT INTO ea_settings (user_id, email_triage_mode)
            VALUES (?, 'real')
            ON CONFLICT(user_id) DO NOTHING`,
      args: [row.user_id],
    },
    {
      sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               account_color, account_icon, from_name, from_address,
               subject, body_snippet, body_text, email_date, read)
            VALUES (?, ?, ?, ?, ?, '#818cf8', 'Mail', ?, ?, ?, ?, ?, ?, 0)`,
      args: [
        row.uid,
        row.user_id,
        row.account_id,
        row.account_label,
        row.account_email,
        row.from_name,
        row.from_address,
        row.subject,
        row.body_snippet,
        row.body_text,
        row.email_date,
      ],
    },
    {
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id)
            VALUES (?, ?, ?)`,
      args: [row.user_id, row.account_id, row.uid],
    },
    {
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', ?)`,
      args: [
        row.user_id,
        row.account_id,
        row.uid,
        `email_triage:${row.user_id}:${row.account_id}:${row.uid}`,
      ],
    },
  ]);
  return row;
}

describe("email triage worker", () => {
  it("delays weak-risk security once and exposes pending snapshot metadata", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Account Security",
      from_address: "security@example.com",
      subject: "New sign-in to your account",
      body_snippet: "We noticed a sign-in from Chrome on macOS.",
      body_text: "We noticed a sign-in from Chrome on macOS. If this was you, no action is needed.",
    });
    const events = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event) => events.push(event));
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
    expect(modelClient.classify).not.toHaveBeenCalled();

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
    expect(JSON.parse(triage.rows[0].decision_metadata_json)).toMatchObject({
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
      }),
    ]);
    unsubscribe();
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
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: "SELECT lane, triage_status, triage_source FROM ea_email_triage WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      triage_status: "complete",
      triage_source: "weak_security_grace_read",
    });
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
    expect(modelClient.classify).toHaveBeenCalledTimes(1);

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

  it("recovers stale running email triage and Gmail history jobs without resetting attempts", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.batch([
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, ?, 'email_triage', 'running', ?, 2, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "msg-1",
          "email_triage:user-1:gmail-work:msg-1",
          "2026-05-03T11:40:00.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, NULL, 'gmail_history_sync', 'running', ?, 3, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "gmail_history_sync:user-1:gmail-work:100",
          "2026-05-03T11:44:59.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, ?, 'email_triage', 'running', ?, 5, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "fresh-msg",
          "email_triage:user-1:gmail-work:fresh-msg",
          "2026-05-03T11:50:01.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, ?, 'other_job', 'running', ?, 7, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "other-msg",
          "other_job:user-1:gmail-work:other-msg",
          "2026-05-03T11:30:00.000Z",
        ],
      },
    ]);

    const result = await recoverStaleRunningTriageJobs({
      dbClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(result.recovered).toBe(2);
    const jobs = await dbClient.execute({
      sql: `SELECT job_type, email_id, status, attempts, locked_at, last_error
            FROM ea_triage_jobs
            ORDER BY id`,
      args: [],
    });
    expect(jobs.rows).toEqual([
      {
        job_type: "email_triage",
        email_id: "msg-1",
        status: "queued",
        attempts: 2,
        locked_at: null,
        last_error: "Recovered stale running job",
      },
      {
        job_type: "gmail_history_sync",
        email_id: null,
        status: "queued",
        attempts: 3,
        locked_at: null,
        last_error: "Recovered stale running job",
      },
      expect.objectContaining({
        job_type: "email_triage",
        email_id: "fresh-msg",
        status: "running",
        attempts: 5,
      }),
      expect.objectContaining({
        job_type: "other_job",
        email_id: "other-msg",
        status: "running",
        attempts: 7,
      }),
    ]);
    await dbClient.close();
  });

  it("finalizes queued mail with no-model fallback without model calls or bill candidates", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment due tomorrow",
      body_snippet: "Your utility payment of $120 is due tomorrow.",
      body_text: "Your utility payment of $120 is due tomorrow.",
      from_name: "Utility Billing",
      from_address: "billing@utility.example",
    });
    await dbClient.execute({
      sql: "UPDATE ea_settings SET email_triage_mode = 'no_model' WHERE user_id = ?",
      args: ["user-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:10:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "needs_attention",
      source: "no_model_fallback",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: `SELECT lane, category, urgency, escalation_badge, triage_status,
                   triage_source, summary, action, model_usage_json,
                   cheap_model_result_json, strong_model_result_json,
                   estimated_cost_usd, latency_ms, bill_candidate_json
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "needs_attention",
      category: "uncategorized",
      urgency: "normal",
      escalation_badge: "Needs Review",
      triage_status: "complete",
      triage_source: "no_model_fallback",
      summary: "Your utility payment of $120 is due tomorrow.",
      action: "Review",
      model_usage_json: "{}",
      cheap_model_result_json: null,
      strong_model_result_json: null,
      estimated_cost_usd: null,
      latency_ms: null,
      bill_candidate_json: null,
    });

    const items = await dbClient.execute({
      sql: `SELECT lane_at_snapshot, action_at_snapshot, escalation_badge_at_snapshot
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(items.rows[0]).toMatchObject({
      lane_at_snapshot: "needs_attention",
      action_at_snapshot: "Review",
      escalation_badge_at_snapshot: "Needs Review",
    });
  });

  it("leaves email triage jobs queued when mode is paused", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient);
    await dbClient.execute({
      sql: "UPDATE ea_settings SET email_triage_mode = 'paused' WHERE user_id = ?",
      args: ["user-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:12:00.000Z"),
    });

    expect(result).toEqual({
      processed: false,
      paused: true,
      email_triage_mode: "paused",
      effective_email_triage_mode: "paused",
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const jobs = await dbClient.execute({
      sql: "SELECT status, attempts, locked_at FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      locked_at: null,
    });
  });

  it("finalizes obvious noise with rules only and attaches it to the active snapshot", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient);
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:15:00.000Z"),
    });

    expect(result).toEqual({
      processed: true,
      job_id: expect.any(Number),
      email_id: "msg-1",
      lane: "noise",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const triage = await dbClient.execute({
      sql: `SELECT lane, category, urgency, triage_status, triage_source,
                   confidence, summary, action, model_usage_json,
                   cheap_model_result_json, strong_model_result_json
            FROM ea_email_triage
            WHERE user_id = ? AND account_id = ? AND email_id = ?`,
      args: ["user-1", "gmail-work", "msg-1"],
    });
    expect(triage.rows[0]).toMatchObject({
      lane: "noise",
      category: "marketing",
      urgency: "low",
      triage_status: "complete",
      triage_source: "rule",
      confidence: 0.94,
      summary: "Promotional or bulk email.",
      action: "Ignore",
      model_usage_json: "{}",
      cheap_model_result_json: null,
      strong_model_result_json: null,
    });

    const items = await dbClient.execute({
      sql: `SELECT lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
                   category_at_snapshot, subject_at_snapshot, from_address_at_snapshot
            FROM ea_briefing_snapshot_items
            WHERE user_id = ? AND account_id = ? AND email_id = ?`,
      args: ["user-1", "gmail-work", "msg-1"],
    });
    expect(items.rows).toEqual([
      expect.objectContaining({
        lane_at_snapshot: "noise",
        summary_at_snapshot: "Promotional or bulk email.",
        action_at_snapshot: "Ignore",
        category_at_snapshot: "marketing",
        subject_at_snapshot: "Weekend sale - 40% off",
        from_address_at_snapshot: "deals@example.com",
      }),
    ]);
  });

  it("keeps configured email interests out of noise", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Anthropic",
      from_address: "news@anthropic.com",
      subject: "Weekend sale - 40% off",
      body_snippet: "Unsubscribe any time.",
      body_text: "Sale ends soon. Unsubscribe any time.",
    });
    await dbClient.execute({
      sql: "UPDATE ea_settings SET email_interests_json = ? WHERE user_id = ?",
      args: [JSON.stringify(["Anthropic"]), "user-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:15:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: `SELECT lane, category, triage_source, summary, action, decision_metadata_json
            FROM ea_email_triage WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "updates",
      triage_source: "rule",
      summary: "Matched email interest: Anthropic.",
      action: "Review when convenient",
    });
    expect(JSON.parse(rows.rows[0].decision_metadata_json)).toMatchObject({
      preflight: {
        reasonCode: "email_interest_promoted_noise_to_fyi",
        matchedInterest: "Anthropic",
        interestPromotion: {
          originalLane: "noise",
          originalReasonCode: "marketing_noise",
        },
      },
    });
  });

  it("finalizes one-time verification codes without model calls", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Here's your verification code 367936",
      body_snippet: "Please verify it's you. This code expires soon.",
      body_text: "Please verify it's you. Enter verification code 367936 to continue.",
      from_name: "LinkedIn",
      from_address: "security-noreply@linkedin.com",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:16:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "noise",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: `SELECT lane, category, urgency, triage_source, summary, action,
                   cheap_model_result_json, strong_model_result_json
            FROM ea_email_triage WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "noise",
      category: "security",
      urgency: "low",
      triage_source: "rule",
      summary: "One-time authentication code.",
      action: "Ignore",
      cheap_model_result_json: null,
      strong_model_result_json: null,
    });
  });

  it("finalizes obvious promotional subject lines without model calls", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Your promo code unlocks free shipping today",
      body_snippet: "Use this limited offer before it expires.",
      body_text: "Use this limited offer before it expires.",
      from_name: "Shop",
      from_address: "offers@shop.example",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:17:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "noise",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: "SELECT lane, category, triage_source, summary, action FROM ea_email_triage WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "noise",
      category: "marketing",
      triage_source: "rule",
      summary: "Promotional or bulk email.",
      action: "Ignore",
    });
  });

  it("stores preflight reason metadata for no-model rule finalization", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "USPS Informed Delivery",
      from_address: "informeddelivery@usps.com",
      subject: "Your Daily Digest for May 5",
      body_snippet: "Mail and packages arriving soon.",
      body_text: "This digest includes an unsubscribe footer.",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:18:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: `SELECT lane, category, decision_metadata_json
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "delivery",
    });
    expect(JSON.parse(rows.rows[0].decision_metadata_json)).toMatchObject({
      preflight: {
        action: "finalize",
        reasonCode: "delivery_digest_fyi",
        matchedRuleKey: "default_delivery_digest_fyi",
        modelSaved: true,
      },
    });
  });

  it("routes high-risk payment mail directly to the strong model and stores usage", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment due for tuition",
      body_snippet: "Your payment due date is May 8.",
      body_text: "Tuition balance $450.00 is due May 8.",
      from_name: "University Billing",
      from_address: "billing@school.example",
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
          bill_candidate: {
            payee_hint: "University Billing",
            amount: 450,
            due_date: "2026-05-08",
            requires_confirmation: true,
          },
        },
        usage: { input_tokens: 120, output_tokens: 40 },
        estimated_cost_usd: 0.004,
        latency_ms: 600,
        tier,
      })),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:20:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "needs_attention",
      source: "strong_model",
      model_calls: ["strong"],
    });
    expect(modelClient.classify).toHaveBeenCalledTimes(1);
    expect(modelClient.classify).toHaveBeenCalledWith(expect.objectContaining({
      tier: "strong",
      email: expect.objectContaining({ subject: "Payment due for tuition" }),
    }));

    const rows = await dbClient.execute({
      sql: `SELECT triage_status, triage_source, model_usage_json,
                   cheap_model_result_json, strong_model_result_json,
                   estimated_cost_usd, latency_ms, bill_candidate_json
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      triage_status: "complete",
      triage_source: "strong_model",
      cheap_model_result_json: null,
      estimated_cost_usd: 0.004,
      latency_ms: 600,
    });
    expect(JSON.parse(rows.rows[0].model_usage_json)).toEqual({
      strong: { input_tokens: 120, output_tokens: 40 },
    });
    expect(JSON.parse(rows.rows[0].strong_model_result_json)).toMatchObject({
      decision: { category: "finance" },
      tier: "strong",
    });
    expect(JSON.parse(rows.rows[0].bill_candidate_json)).toMatchObject({
      payee_hint: "University Billing",
      amount: 450,
      requires_confirmation: true,
    });
  });

  it("uses the configured email summary model for direct strong triage", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.execute({
      sql: `INSERT INTO ea_settings
              (user_id, email_ai_provider, email_ai_model, bill_extract_provider, bill_extract_model, email_triage_mode)
            VALUES (?, 'openai', 'gpt-5.4', 'anthropic', 'claude-haiku-4-5', 'real')`,
      args: ["user-1"],
    });
    await queueEmail(dbClient, {
      subject: "Security alert: payment due",
      body_snippet: "Review this payment due security alert.",
      body_text: "Your account has a security alert and a payment due. Review now.",
      from_name: "Bank Security",
      from_address: "security@bank.example",
    });

    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "gpt-5.4",
        output: [{
          type: "function_call",
          name: "submit_email_triage",
          arguments: JSON.stringify({
            lane: "needs_attention",
            category: "security",
            urgency: "high",
            escalation_badge: "High Risk",
            summary: "Security payment alert needs review.",
            action: "Review account",
            deadline_at: null,
            confidence: 0.91,
            bill_candidate: null,
          }),
        }],
        usage: {
          input_tokens: 90,
          output_tokens: 30,
          prompt_tokens_details: { cached_tokens: 48 },
        },
      }),
    });

    try {
      const result = await processNextEmailTriageJob({
        dbClient,
        now: new Date("2026-05-03T12:21:00.000Z"),
      });

      expect(result).toMatchObject({
        processed: true,
        lane: "needs_attention",
        source: "strong_model",
        model_calls: ["strong"],
      });
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      expect(body.model).toBe("gpt-5.4");
      expect(body.store).toBe(false);
      expect(body.prompt_cache_key).toBe("ea-email-triage:v1:strong:gpt-5.4");
      expect(body.prompt_cache_retention).toBe("24h");
      expect(consoleLog).toHaveBeenCalledWith(
        "[Email Triage] OpenAI cache tier=strong model=gpt-5.4 input=90 output=30 cached=48 key=ea-email-triage:v1:strong:gpt-5.4",
      );
    } finally {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
      global.fetch = undefined;
      consoleLog.mockRestore();
    }
  });

  it("keeps account recovery and new sign-in code mail on the strong model", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "New sign-in verification code",
      body_snippet: "A new sign-in used your verification code. Review if this wasn't you.",
      body_text: "A new sign-in used your verification code. Review account recovery options if this wasn't you.",
      from_name: "Account Security",
      from_address: "security@example.com",
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "needs_attention",
          category: "security",
          urgency: "high",
          escalation_badge: "High Risk",
          summary: "New sign-in needs review.",
          action: "Review account activity",
          deadline_at: null,
          confidence: 0.93,
          bill_candidate: null,
        },
        usage: { input_tokens: 90, output_tokens: 30 },
        tier,
      })),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:21:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "needs_attention",
      source: "strong_model",
      model_calls: ["strong"],
    });
    expect(modelClient.classify).toHaveBeenCalledTimes(1);
    expect(modelClient.classify).toHaveBeenCalledWith(expect.objectContaining({ tier: "strong" }));
  });

  it("uses enabled database rules before falling back to model routing", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_rules
              (user_id, name, priority, rule_type, match_json,
               lane, category, urgency, confidence, reason)
            VALUES (?, 'Delivery vendor FYI', 5, 'sender_domain', ?,
                    'fyi', 'delivery', 'low', 0.91, 'Trusted delivery notification.')`,
      args: ["user-1", JSON.stringify({ from_domains: ["vendor.example"] })],
    });
    await queueEmail(dbClient, {
      subject: "Package status update",
      body_snippet: "Your package is on the way.",
      body_text: "Your package is on the way.",
      from_name: "Vendor",
      from_address: "alerts@vendor.example",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:22:00.000Z"),
    });

    expect(result).toMatchObject({
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: "SELECT lane, category, confidence, triage_source, rule_id FROM ea_email_triage WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "delivery",
      confidence: 0.91,
      triage_source: "rule",
      rule_id: 1,
    });
  });

  it("retries OpenAI triage without cache-only fields when a model rejects them", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.execute({
      sql: `INSERT INTO ea_settings
              (user_id, email_ai_provider, email_ai_model, bill_extract_provider, bill_extract_model, email_triage_mode)
            VALUES (?, 'openai', 'gpt-5.4', 'anthropic', 'claude-haiku-4-5', 'real')`,
      args: ["user-1"],
    });
    await queueEmail(dbClient, {
      subject: "Security alert: payment due",
      body_snippet: "Review this payment due security alert.",
      body_text: "Your account has a security alert and a payment due. Review now.",
      from_name: "Bank Security",
      from_address: "security@bank.example",
    });

    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Unknown parameter: prompt_cache_retention",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "gpt-5.4",
          output: [{
            type: "function_call",
            name: "submit_email_triage",
            arguments: JSON.stringify({
              lane: "needs_attention",
              category: "security",
              urgency: "high",
              escalation_badge: "High Risk",
              summary: "Security payment alert needs review.",
              action: "Review account",
              deadline_at: null,
              confidence: 0.91,
              bill_candidate: null,
            }),
          }],
          usage: { input_tokens: 90, output_tokens: 30 },
        }),
      });

    try {
      const result = await processNextEmailTriageJob({
        dbClient,
        now: new Date("2026-05-03T12:22:00.000Z"),
      });

      expect(result).toMatchObject({
        processed: true,
        lane: "needs_attention",
        source: "strong_model",
        model_calls: ["strong"],
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      const retryBody = JSON.parse(global.fetch.mock.calls[1][1].body);
      expect(firstBody.prompt_cache_key).toBe("ea-email-triage:v1:strong:gpt-5.4");
      expect(firstBody.prompt_cache_retention).toBe("24h");
      expect(retryBody.store).toBe(false);
      expect(retryBody.prompt_cache_key).toBeUndefined();
      expect(retryBody.prompt_cache_retention).toBeUndefined();
      expect(consoleWarn).toHaveBeenCalledWith(
        "[Email Triage] OpenAI cache fields rejected for tier=strong model=gpt-5.4; retrying without cache-only fields",
      );
    } finally {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
      global.fetch = undefined;
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("escalates low-confidence cheap results and stores both model results", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Question about next week",
      body_snippet: "Can you take a look and let me know?",
      body_text: "Can you take a look and let me know what you think?",
      from_name: "Sam",
      from_address: "sam@example.com",
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => {
        if (tier === "cheap") {
          return {
            decision: {
              lane: "fyi",
              category: "updates",
              urgency: "normal",
              summary: "May need a review.",
              action: "Review",
              confidence: 0.41,
            },
            usage: { input_tokens: 50, output_tokens: 20 },
            estimated_cost_usd: 0.001,
            latency_ms: 100,
            tier,
          };
        }
        return {
          decision: {
            lane: "needs_attention",
            category: "personal",
            urgency: "normal",
            summary: "Sam is asking for a response.",
            action: "Reply",
            confidence: 0.9,
          },
          usage: { input_tokens: 70, output_tokens: 25 },
          estimated_cost_usd: 0.003,
          latency_ms: 300,
          tier,
        };
      }),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:25:00.000Z"),
    });

    expect(result).toMatchObject({
      lane: "needs_attention",
      source: "strong_model",
      model_calls: ["cheap", "strong"],
    });
    expect(modelClient.classify.mock.calls.map(([call]) => call.tier)).toEqual(["cheap", "strong"]);

    const rows = await dbClient.execute({
      sql: `SELECT lane, triage_source, model_usage_json,
                   cheap_model_result_json, strong_model_result_json,
                   estimated_cost_usd, latency_ms
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "needs_attention",
      triage_source: "strong_model",
      estimated_cost_usd: 0.004,
      latency_ms: 400,
    });
    expect(JSON.parse(rows.rows[0].model_usage_json)).toEqual({
      cheap: { input_tokens: 50, output_tokens: 20 },
      strong: { input_tokens: 70, output_tokens: 25 },
    });
    expect(JSON.parse(rows.rows[0].cheap_model_result_json)).toMatchObject({
      decision: { confidence: 0.41 },
      tier: "cheap",
    });
    expect(JSON.parse(rows.rows[0].strong_model_result_json)).toMatchObject({
      decision: { lane: "needs_attention" },
      tier: "strong",
    });
  });

  it("finalizes routine finance confirmations without model calls", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment confirmation",
      body_snippet: "Your direct deposit payment of $445.27 has been submitted.",
      body_text: "Your direct deposit payment of $445.27 has been submitted and should arrive in 3 business days.",
      from_name: "IHSS/WPCS E-Timesheets",
      from_address: "donotreply@etimesheets.ihss.ca.gov",
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "fyi",
          category: "finance",
          urgency: "normal",
          escalation_badge: null,
          summary: "Payment confirmation for $445.27.",
          action: "No action needed.",
          deadline_at: null,
          confidence: 0.93,
          bill_candidate: null,
        },
        usage: { input_tokens: 80, output_tokens: 20 },
        estimated_cost_usd: 0.001,
        latency_ms: 120,
        tier,
      })),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:28:00.000Z"),
    });

    expect(result).toMatchObject({
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: `SELECT lane, category, triage_source, model_usage_json,
                   cheap_model_result_json, strong_model_result_json,
                   estimated_cost_usd, latency_ms
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "finance",
      triage_source: "rule",
      strong_model_result_json: null,
      estimated_cost_usd: null,
      latency_ms: null,
    });
    expect(JSON.parse(rows.rows[0].model_usage_json)).toEqual({});
    expect(rows.rows[0].cheap_model_result_json).toBeNull();
  });

  it("finalizes routine autopay scheduled notices without treating soft review as action", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "An autopay is coming up soon for your card",
      body_snippet: "Autopay of $162.00 is scheduled. Review your statement if interested.",
      body_text: "Autopay of $162.00 is scheduled. Review your statement if interested. No action is needed.",
      from_name: "Card Services",
      from_address: "alerts@card.example",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:29:30.000Z"),
    });

    expect(result).toMatchObject({
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();
  });

  it("uses the configured bill extraction model for cheap triage", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.execute({
      sql: `INSERT INTO ea_settings
              (user_id, email_ai_provider, email_ai_model, bill_extract_provider, bill_extract_model, email_triage_mode)
            VALUES (?, 'anthropic', 'claude-sonnet-4-6', 'openai', 'gpt-5.4-nano', 'real')`,
      args: ["user-1"],
    });
    await queueEmail(dbClient, {
      subject: "Package update",
      body_snippet: "Your item is moving through the network.",
      body_text: "Your item is moving through the network and does not require action.",
      from_name: "Shipping Desk",
      from_address: "updates@shipper.example",
    });

    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "gpt-5.4-nano",
        output: [{
          type: "function_call",
          name: "submit_email_triage",
          arguments: JSON.stringify({
            lane: "fyi",
            category: "delivery",
            urgency: "low",
            escalation_badge: null,
            summary: "Package status update.",
            action: "No action needed.",
            deadline_at: null,
            confidence: 0.94,
            bill_candidate: null,
          }),
        }],
        usage: { input_tokens: 70, output_tokens: 20 },
      }),
    });

    try {
      const result = await processNextEmailTriageJob({
        dbClient,
        now: new Date("2026-05-03T12:29:00.000Z"),
      });

      expect(result).toMatchObject({
        processed: true,
        lane: "fyi",
        source: "cheap_model",
        model_calls: ["cheap"],
      });
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      expect(body.model).toBe("gpt-5.4-nano");
      expect(body.store).toBe(false);
      expect(body.prompt_cache_key).toBe("ea-email-triage:v1:cheap:gpt-5.4-nano");
      expect(body.prompt_cache_retention).toBe("24h");
    } finally {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
      global.fetch = undefined;
      consoleLog.mockRestore();
    }
  });

  it("drops generic model escalation badges from FYI decisions", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment confirmation",
      body_snippet: "Your direct deposit payment has been submitted.",
      body_text: "Your direct deposit payment has been submitted and should arrive soon.",
      from_name: "IHSS/WPCS E-Timesheets",
      from_address: "donotreply@etimesheets.ihss.ca.gov",
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "fyi",
          category: "finance",
          urgency: "normal",
          escalation_badge: "ESCALATED",
          summary: "Payment confirmation.",
          action: "No action needed.",
          deadline_at: null,
          confidence: 0.91,
          bill_candidate: null,
        },
        usage: { input_tokens: 80, output_tokens: 20 },
        tier,
      })),
    };

    await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:29:00.000Z"),
    });

    const rows = await dbClient.execute({
      sql: `SELECT escalation_badge, lane
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      escalation_badge: null,
    });

    const items = await dbClient.execute({
      sql: `SELECT escalation_badge_at_snapshot
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(items.rows[0].escalation_badge_at_snapshot).toBeNull();
  });

  it("fails open into Needs Attention with Needs Review when model triage fails", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Can you review this?",
      body_snippet: "Please review the attached request.",
      body_text: "Please review the attached request.",
      from_name: "Requester",
      from_address: "requester@example.com",
    });
    const modelClient = {
      classify: vi.fn(async () => {
        throw new Error("model unavailable");
      }),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:30:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "needs_attention",
      source: "failure_fallback",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: `SELECT lane, triage_status, escalation_badge, summary, action
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "needs_attention",
      triage_status: "failed",
      escalation_badge: "Needs Review",
      summary: "Please review the attached request.",
      action: "Review",
    });

    const jobs = await dbClient.execute({
      sql: "SELECT status, last_error FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "complete",
      last_error: "model unavailable",
    });
  });

  it("skips already-finalized triage rows instead of reprocessing them", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Already handled",
      body_snippet: "This row was previously triaged.",
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET triage_status = 'complete',
                last_triaged_at = '2026-05-03T11:00:00.000Z',
                lane = 'fyi'
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:35:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      skipped: true,
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const snapshots = await dbClient.execute({
      sql: "SELECT * FROM ea_briefing_snapshot_items WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(snapshots.rows).toHaveLength(0);
  });
});
