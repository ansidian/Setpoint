import { describe, expect, it, vi } from "vitest";
import { clearCurrentDashboardEventSubscribers, subscribeCurrentDashboardEvents } from "../dashboard/current-events.ts";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import { processNextEmailTriageJob } from "./triage-worker.ts";
import type { InStatement } from "@libsql/client";

// test-architecture: allow-boundary-mock -- AI API-key resolution is a write-only secret boundary; routing tests use process-local test credentials while asserting migrated decision/usage rows.
vi.mock("../ai-credentials.ts", () => ({
  resolveAiApiKey: async (provider: "openai" | "anthropic") =>
    process.env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"] || null,
}));

describe("email triage worker model routing", () => {
  it("persists the same financial plan candidate for triage and snapshot reads", async () => {
    const dbClient = await createMigratedDb();
    const queued = await queueEmail(dbClient, {
      subject: "Your warehouse order",
      body_snippet: "Order total $84.12",
      body_text: "Your Costco order total is $84.12.",
      from_name: "Costco",
      from_address: "orders@costco.com",
    });
    await dbClient.execute({
      sql: "UPDATE ea_email_index SET sender_authentication_json = ? WHERE uid = ?",
      args: [JSON.stringify({
        version: 1,
        status: "pass",
        provider: "gmail",
        source: "gmail_authentication_results",
        headerFromDomain: "costco.com",
        dkim: [{ result: "pass", domain: "costco.com", aligned: true }],
        spf: null,
        dmarc: { result: "pass", domain: "costco.com", aligned: true },
        evaluatedAt: "2026-05-03T12:00:00.000Z",
      }), queued.uid],
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "fyi",
          category: "finance",
          urgency: "normal",
          escalation_badge: null,
          summary: "Costco order confirmed.",
          action: "Review order",
          deadline_at: null,
          confidence: 0.98,
          bill_candidate: {
            payee_hint: "Costco",
            amount: 84.12,
            amount_kind: "order_total",
            amount_candidates: [{ kind: "order_total", value: 84.12 }],
            event_kind: "purchase",
            event_confidence: 0.99,
            event_evidence: "order total",
          },
        },
        usage: { input_tokens: 80, output_tokens: 30 },
        latency_ms: 300,
        tier,
      })),
    };
    let plannerInput: Record<string, unknown> | null = null;
    const financialEmailPlanner = async (_userId: string, input: { candidate?: Record<string, unknown> | null; sourceIdentity?: Record<string, unknown> }) => {
      plannerInput = input as Record<string, unknown>;
      const candidate = {
        ...input.candidate,
        target_policy_key: "policy_warehouse",
        target_confidence: 0.99,
        target_evidence: "Costco order",
        target_verification: { status: "selected" as const, option_count: 2, provider: "openai", model: "gpt-5.4-mini" },
        category_id: "category-warehouse",
        category_label: "Warehouse",
        semantic_enrichment: { status: "complete" as const, provider: "openai", model: "gpt-5.4-mini" },
      };
      return {
        version: 1 as const,
        candidate,
        classification: { documentKind: "one_time_transaction" as const, eventKind: "purchase" as const, confidence: 0.99, reasons: [] },
        operation: { intended: "create_transaction" as const, kind: "review" as const, reasons: ["due_date_missing" as const] },
        targets: {
          account: { kind: "account" as const, status: "unresolved" as const, provenance: [] },
          payee: { kind: "payee" as const, status: "resolved" as const, id: "payee-costco", label: "Costco", provenance: [] },
          category: { kind: "category" as const, status: "resolved" as const, id: "category-warehouse", label: "Warehouse", provenance: [] },
          fromAccount: { kind: "from_account" as const, status: "not_applicable" as const, provenance: [] },
          toAccount: { kind: "to_account" as const, status: "not_applicable" as const, provenance: [] },
          schedule: { kind: "schedule" as const, status: "not_applicable" as const, provenance: [] },
        },
        reconciliation: { status: "not_checked" as const, disposition: "review" as const },
        reviewReasons: [{ code: "due_date_missing" as const, message: "A date is required.", field: "due_date", blocking: true }],
        automation: { eligible: false, gates: [], reasons: ["due_date_missing" as const] },
      };
    };

    await processNextEmailTriageJob({
      dbClient,
      modelClient,
      financialEmailPlanner: financialEmailPlanner as never,
      now: new Date("2026-05-03T12:20:00.000Z"),
    });

    const rows = await dbClient.execute({
      sql: `SELECT t.bill_candidate_json AS triage_candidate,
                   t.financial_email_plan_json AS financial_plan,
                   t2.bill_candidate_json AS snapshot_candidate
            FROM ea_email_triage t
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            JOIN ea_email_triage t2 ON t2.id = i.triage_id
            WHERE t.email_id = ?`,
      args: ["msg-1"],
    });
    const triageCandidate = JSON.parse(String(rows.rows[0]!.triage_candidate));
    const financialPlan = JSON.parse(String(rows.rows[0]!.financial_plan));
    const snapshotCandidate = JSON.parse(String(rows.rows[0]!.snapshot_candidate));
    expect(triageCandidate).toEqual(snapshotCandidate);
    expect(triageCandidate).toMatchObject({
      target_policy_key: "policy_warehouse",
      category_id: "category-warehouse",
      semantic_enrichment: { status: "complete" },
    });
    expect(financialPlan).toMatchObject({
      version: 1,
      candidate: triageCandidate,
      operation: { kind: "review" },
    });
    expect(plannerInput).toMatchObject({
      sourceIdentity: {
        provider: "gmail",
        accountId: "gmail-work",
        senderAddress: "orders@costco.com",
        senderAuthentication: "pass",
        authenticationEvidence: expect.arrayContaining([
          "sender-auth:v1",
          "dmarc:pass",
          "dkim:pass:aligned",
        ]),
      },
    });
  });

  it("routes high-risk payment mail directly to the strong model and stores usage", async () => {
    clearCurrentDashboardEventSubscribers();
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
          emailReceivedAt: "2026-05-03T12:00:00.000Z",
          lane: "needs_attention",
          triageSource: "strong_model",
          reason: "email_triage_finalized",
        },
      }),
    ]);
    unsubscribe();
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
    // test-architecture: allow-boundary-interaction -- Model classification is an outbound AI-provider boundary; tier routing order is the cost/quality protocol contract.
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

  it("fails open into Needs Attention with Needs Review when model triage fails", async () => {
    clearCurrentDashboardEventSubscribers();
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
          emailReceivedAt: "2026-05-03T12:00:00.000Z",
          lane: "needs_attention",
          triageSource: "failure_fallback",
          reason: "email_triage_failed",
        },
      }),
    ]);
    unsubscribe();
    });

  it("defers a retryable model error (429) instead of marking the email failed (P2-32)", async () => {
    clearCurrentDashboardEventSubscribers();
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
    clearCurrentDashboardEventSubscribers();
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
    clearCurrentDashboardEventSubscribers();
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
    clearCurrentDashboardEventSubscribers();
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
