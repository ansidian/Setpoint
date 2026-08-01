import { describe, expect, it, vi } from "vitest";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import { processNextEmailTriageJob } from "./triage-worker.ts";

describe("email triage worker read-arrivals preference", () => {
  it("continues read arrival-grace rows through the existing triage pipeline when enabled", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Project Team",
      from_address: "teammate@example.com",
      subject: "Planning notes for next week",
      body_snippet: "Here are the notes from our planning session.",
      body_text: "Here are the notes from our planning session and the next steps we discussed.",
    });
    await dbClient.batch([
      {
        sql: "UPDATE ea_settings SET email_triage_classify_read_arrivals = 1 WHERE user_id = ?",
        args: ["user-1"],
      },
      {
        sql: "UPDATE ea_email_index SET read = 1 WHERE uid = ?",
        args: ["msg-1"],
      },
      {
        sql: `UPDATE ea_email_triage
              SET triage_source = 'arrival_grace', triage_status = 'pending'
              WHERE email_id = ?`,
        args: ["msg-1"],
      },
      {
        sql: "UPDATE ea_triage_jobs SET scheduled_for = ? WHERE email_id = ?",
        args: ["2026-05-03T12:03:00.000Z", "msg-1"],
      },
    ]);
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "fyi",
          category: "work",
          urgency: "normal",
          escalation_badge: null,
          summary: "Planning notes and next steps.",
          action: "Review when convenient",
          deadline_at: null,
          confidence: 0.92,
        },
        usage: { input_tokens: 80, output_tokens: 20 },
        estimated_cost_usd: 0.001,
        latency_ms: 250,
        tier,
      })),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:03:30.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "fyi",
      model_calls: ["cheap"],
    });
    expect(modelClient.classify).toHaveBeenCalledTimes(1);
    const job = await dbClient.execute({
      sql: "SELECT status, scheduled_for FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(job.rows[0]).toMatchObject({ status: "complete", scheduled_for: null });
    await dbClient.close();
  });

  it("still honors deterministic preflight finalization for read arrivals", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Example Account",
      from_address: "security@example.com",
      subject: "Your verification code is 123456",
      body_snippet: "Use this code to finish signing in.",
      body_text: "Use verification code 123456 to finish signing in.",
    });
    await dbClient.batch([
      {
        sql: "UPDATE ea_settings SET email_triage_classify_read_arrivals = 1 WHERE user_id = ?",
        args: ["user-1"],
      },
      {
        sql: "UPDATE ea_email_index SET read = 1 WHERE uid = ?",
        args: ["msg-1"],
      },
      {
        sql: `UPDATE ea_email_triage
              SET triage_source = 'arrival_grace', triage_status = 'pending'
              WHERE email_id = ?`,
        args: ["msg-1"],
      },
    ]);
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:03:30.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "noise",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();
    await dbClient.close();
  });
});
