import { describe, expect, it, vi } from "vitest";
import { __resetCurrentDashboardEventsForTests, subscribeCurrentDashboardEvents } from "../dashboard/current-events.js";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import { processNextEmailTriageJob } from "./triage-worker.ts";
import type { InStatement } from "@libsql/client";

describe("email triage worker model routing", () => {
  it("routes high-risk payment mail directly to the strong model and stores usage", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment due for tuition",
      body_snippet: "Your payment due date is May 8.",
      body_text: "Tuition balance $450.00 is due May 8.",
      from_name: "University Billing",
      from_address: "billing@school.example",
    });
    const events: Record<string, unknown>[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event: Record<string, unknown>) => events.push(event));
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
                   estimated_cost_usd, latency_ms, bill_candidate_json,
                   last_decision_reason
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      triage_status: "complete",
      triage_source: "strong_model",
      cheap_model_result_json: null,
      // P3-69: estimated_cost_usd is now always persisted as null (the model client
      // never returns a real cost; spend is recomputed from tokens in triage-cache-stats).
      estimated_cost_usd: null,
      latency_ms: 600,
      last_decision_reason: "routed_strong:hard_risk_override",
    });
    expect(JSON.parse(String(rows.rows[0]!.model_usage_json))).toEqual({
      strong: { input_tokens: 120, output_tokens: 40 },
    });
    expect(JSON.parse(String(rows.rows[0]!.strong_model_result_json))).toMatchObject({
      decision: { category: "finance" },
      tier: "strong",
    });
    expect(JSON.parse(String(rows.rows[0]!.bill_candidate_json))).toMatchObject({
      payee_hint: "University Billing",
      amount: 450,
      requires_confirmation: true,
    });
    expect(events).toEqual([
      expect.objectContaining({
        source: "email_triage",
        reason: "email_triage_finalized",
        details: {
          triggerType: "needs_attention_finalized",
          eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
          emailId: "msg-1",
          lane: "needs_attention",
          triageSource: "strong_model",
          reason: "email_triage_finalized",
        },
      }),
    ]);
    unsubscribe();
    });

  it("uses the configured inbox triage model for direct strong triage", async () => {
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
    const originalFetch = global.fetch;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => ({
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
    }) as unknown as Response);
    global.fetch = fetchMock;

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
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(String(options!.body));
      expect(body.model).toBe("gpt-5.4");
      expect(body.store).toBe(false);
      expect(body.prompt_cache_key).toBe("ea-email-triage:v1:strong:gpt-5.4");
      expect(body.prompt_cache_retention).toBe("24h");
      expect(consoleLog).toHaveBeenCalledWith(
        "[Email Triage] OpenAI cache tier=strong model=gpt-5.4 input=90 output=30 cached=48 key=ea-email-triage:v1:strong:gpt-5.4",
      );
    } finally {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
      global.fetch = originalFetch;
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
    const originalFetch = global.fetch;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (_input: string | URL | Request, _options?: RequestInit): Promise<Response> => ({ ok: true } as Response))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Unknown parameter: prompt_cache_retention",
      } as Response)
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
      } as Response);
    global.fetch = fetchMock;

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
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
      const retryBody = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body));
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
      global.fetch = originalFetch;
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
                   estimated_cost_usd, latency_ms, last_decision_reason
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "needs_attention",
      triage_source: "strong_model",
      // P3-69: per-result cost is no longer derived (always null), and the escalation
      // path sums the cheap + strong costs — null + null === 0 — so an escalated
      // decision persists 0 rather than the old fabricated 0.004. Either way it is a
      // dead figure; real spend is recomputed from tokens in triage-cache-stats.
      estimated_cost_usd: 0,
      latency_ms: 400,
      last_decision_reason: "escalated:cheap_confidence_below_floor",
    });
    expect(JSON.parse(String(rows.rows[0]!.model_usage_json))).toEqual({
      cheap: { input_tokens: 50, output_tokens: 20 },
      strong: { input_tokens: 70, output_tokens: 25 },
    });
    expect(JSON.parse(String(rows.rows[0]!.cheap_model_result_json))).toMatchObject({
      decision: { confidence: 0.41 },
      tier: "cheap",
    });
    expect(JSON.parse(String(rows.rows[0]!.strong_model_result_json))).toMatchObject({
      decision: { lane: "needs_attention" },
      tier: "strong",
    });
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
    const originalFetch = global.fetch;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => ({
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
    }) as unknown as Response);
    global.fetch = fetchMock;

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
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(String(options!.body));
      expect(body.model).toBe("gpt-5.4-nano");
      expect(body.store).toBe(false);
      expect(body.prompt_cache_key).toBe("ea-email-triage:v1:cheap:gpt-5.4-nano");
      expect(body.prompt_cache_retention).toBe("24h");

      const rows = await dbClient.execute({
        sql: "SELECT last_decision_reason FROM ea_email_triage WHERE email_id = ?",
        args: ["msg-1"],
      });
      expect(rows.rows[0]!.last_decision_reason).toBe("cheap_accepted");
    } finally {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
      global.fetch = originalFetch;
      consoleLog.mockRestore();
    }
    });

  it("fails open into Needs Attention with Needs Review when model triage fails", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Can you review this?",
      body_snippet: "Please review the attached request.",
      body_text: "Please review the attached request.",
      from_name: "Requester",
      from_address: "requester@example.com",
    });
    const events: Record<string, unknown>[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event: Record<string, unknown>) => events.push(event));
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
      sql: `SELECT lane, triage_status, escalation_badge, summary, action,
                   last_decision_reason
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
      last_decision_reason: "failure_fallback",
    });

    const jobs = await dbClient.execute({
      sql: "SELECT status, last_error FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "complete",
      last_error: "model unavailable",
    });
    expect(events).toEqual([
      expect.objectContaining({
        source: "email_triage",
        reason: "email_triage_failed",
        details: {
          triggerType: "triage_failed",
          eventKey: "email_triage:gmail-work:msg-1:email_triage_failed",
          emailId: "msg-1",
          lane: "needs_attention",
          triageSource: "failure_fallback",
          reason: "email_triage_failed",
        },
      }),
    ]);
    unsubscribe();
    });

  it("defers a retryable model error (429) instead of marking the email failed (P2-32)", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment due for tuition",
      body_snippet: "Your payment due date is May 8.",
      body_text: "Tuition balance $450.00 is due May 8.",
      from_name: "University Billing",
      from_address: "billing@school.example",
    });
    const modelClient = {
      classify: vi.fn().mockRejectedValue(
        Object.assign(new Error("OpenAI triage API error (429)"), { status: 429, retryable: true }),
      ),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:20:00.000Z"),
    });

    expect(result).toMatchObject({ deferred: true });
    const jobRow = await dbClient.execute("SELECT status, scheduled_for FROM ea_triage_jobs LIMIT 1");
    expect(jobRow.rows[0]!.status).toBe("queued"); // re-queued with backoff, not terminal-failed
    expect(jobRow.rows[0]!.scheduled_for).not.toBeNull();
    const triageRow = await dbClient.execute("SELECT triage_status FROM ea_email_triage LIMIT 1");
    expect(triageRow.rows[0]?.triage_status).not.toBe("failed");
  });

  it("computes retry backoff from the actual post-claim attempt count", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment due for tuition",
      from_name: "University Billing",
      from_address: "billing@school.example",
    });
    const modelClient = {
      classify: vi.fn().mockRejectedValue(
        Object.assign(new Error("OpenAI triage API error (429)"), { status: 429, retryable: true }),
      ),
    };
    const now = new Date("2026-05-03T12:20:00.000Z");

    await processNextEmailTriageJob({ dbClient, modelClient, now });

    // The claim made this the 1st real attempt, so backoff is 2^1 * 30s = 60s
    // (not 2^0 * 30s computed from the stale pre-claim attempts of 0).
    const jobRow = await dbClient.execute("SELECT scheduled_for FROM ea_triage_jobs LIMIT 1");
    expect(jobRow.rows[0]!.scheduled_for).toBe(new Date(now.getTime() + 60_000).toISOString());
  });

  it("goes terminal on the 5th retryable failure instead of granting a 6th attempt", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment due for tuition",
      from_name: "University Billing",
      from_address: "billing@school.example",
    });
    // Seed 4 prior attempts; the claim bumps the DB row to 5 — the final
    // permitted attempt under MAX_TRIAGE_RETRY_ATTEMPTS. A retryable failure
    // here must fall through to the failure_fallback path, not re-queue.
    await dbClient.execute("UPDATE ea_triage_jobs SET attempts = 4");
    const modelClient = {
      classify: vi.fn().mockRejectedValue(
        Object.assign(new Error("OpenAI triage API error (429)"), { status: 429, retryable: true }),
      ),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:20:00.000Z"),
    });

    expect(result.deferred).toBeUndefined();
    const jobRow = await dbClient.execute("SELECT status, attempts FROM ea_triage_jobs LIMIT 1");
    expect(jobRow.rows[0]!.status).toBe("complete"); // terminal: finalized via failure_fallback
    expect(Number(jobRow.rows[0]!.attempts)).toBe(5); // exactly 5 real attempts, never 6
    const triageRow = await dbClient.execute("SELECT triage_status FROM ea_email_triage LIMIT 1");
    expect(triageRow.rows[0]!.triage_status).toBe("failed");
  });

  it("re-queues a job when snapshot attach fails during finalize, not leaving it stuck running (P2-31)", async () => {
    __resetCurrentDashboardEventsForTests();
    const realDb = await createMigratedDb();
    await queueEmail(realDb, {
      subject: "Payment due for tuition",
      body_snippet: "Your payment due date is May 8.",
      body_text: "Tuition balance $450.00 is due May 8.",
      from_name: "University Billing",
      from_address: "billing@school.example",
    });
    // Wrap the db so the snapshot-item INSERT (the attach step) throws.
    const dbClient = {
      execute: vi.fn(async (q: string | InStatement) => {
        const sql = typeof q === "string" ? q : q.sql;
        if (sql.includes("INSERT INTO ea_briefing_snapshot_items")) {
          throw new Error("snapshot item insert failed");
        }
        return realDb.execute(q);
      }),
      batch: realDb.batch.bind(realDb),
    };
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "needs_attention",
          category: "finance",
          urgency: "high",
          summary: "Tuition payment is due soon.",
          action: "Review payment",
          confidence: 0.9,
        },
        usage: { input_tokens: 100, output_tokens: 30 },
        tier,
      })),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:20:00.000Z"),
    });

    expect(result).toMatchObject({ deferred: true });
    const jobRow = await realDb.execute("SELECT status FROM ea_triage_jobs LIMIT 1");
    expect(jobRow.rows[0]!.status).toBe("queued"); // not stuck in 'running'
  });
});
