import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { processNextEmailTriageJob } from "./triage-worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const triageMigrationSql = readFileSync(
  join(__dirname, "../db/migrations/030_triage_snapshots.sql"),
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
  `);
  await db.executeMultiple(triageMigrationSql);
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

  it("keeps high-confidence FYI finance confirmations on the cheap model", async () => {
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
      source: "cheap_model",
      model_calls: ["cheap"],
    });
    expect(modelClient.classify.mock.calls.map(([call]) => call.tier)).toEqual(["cheap"]);

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
      triage_source: "cheap_model",
      strong_model_result_json: null,
      estimated_cost_usd: 0.001,
      latency_ms: 120,
    });
    expect(JSON.parse(rows.rows[0].model_usage_json)).toEqual({
      cheap: { input_tokens: 80, output_tokens: 20 },
    });
    expect(JSON.parse(rows.rows[0].cheap_model_result_json)).toMatchObject({
      decision: { category: "finance", confidence: 0.93 },
      tier: "cheap",
    });
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
