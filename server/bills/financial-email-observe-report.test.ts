import { describe, expect, it } from "vitest";
import { createMigratedDb, queueEmail } from "../triage/triage-worker.test-utils.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import { readFinancialEmailObserveReport } from "./financial-email-observe-report.ts";

function plan(): FinancialEmailPlan {
  return {
    version: 1,
    identity: { version: 1, status: "resolved", key: "financial-email:v1:test" },
    candidate: { type: "expense", event_kind: "purchase", amount: 42 },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 1, reasons: [] },
    operation: { intended: "create_transaction", kind: "review", reasons: ["automation_class_observe_only"] },
    targets: {
      account: { kind: "account", status: "resolved", id: "account-1", provenance: [] },
      payee: { kind: "payee", status: "resolved", id: "payee-1", provenance: [] },
      category: { kind: "category", status: "resolved", id: "category-1", provenance: [] },
      fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
      toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
      schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
    },
    reconciliation: { status: "not_checked", disposition: "review" },
    reviewReasons: [],
    automation: {
      eligible: false,
      operationClass: "one_time_expense",
      rollout: "observe_only",
      gates: [{ gate: "rollout", status: "fail", reasons: ["automation_class_observe_only"] }],
      reasons: ["automation_class_observe_only"],
    },
  };
}

describe("financial email observe report", () => {
  it("reports a bounded redacted cohort without claiming write outcomes", async () => {
    const db = await createMigratedDb();
    await queueEmail(db);
    await db.execute({
      sql: "UPDATE ea_email_triage SET financial_email_plan_json = ? WHERE user_id = ? AND email_id = ?",
      args: [JSON.stringify(plan()), "user-1", "msg-1"],
    });

    await expect(readFinancialEmailObserveReport("user-1", { dbClient: db })).resolves.toEqual({
      writesEnabled: false,
      sampled: 1,
      invalid: 0,
      truncated: false,
      workflow: expect.objectContaining({
        documents: expect.objectContaining({ indexed: 0, assessed: 0, unplannedFailures: 0 }),
        events: expect.objectContaining({ total: 0, recorded: 0, scheduled: 0 }),
      }),
      byOperationClass: expect.objectContaining({
        one_time_expense: {
          attempted: 1,
          eligible: 0,
          reviewed: 1,
          noWrite: 0,
          added: 0,
          updated: 0,
          duplicate: 0,
          failed: 0,
          unsafe: 0,
        },
      }),
    });
    await db.close();
  });

  it("counts malformed legacy plans separately instead of treating them as evidence", async () => {
    const db = await createMigratedDb();
    await queueEmail(db);
    await db.execute({
      sql: "UPDATE ea_email_triage SET financial_email_plan_json = '{\"version\":1}' WHERE user_id = 'user-1'",
      args: [],
    });

    await expect(readFinancialEmailObserveReport("user-1", { dbClient: db })).resolves.toMatchObject({
      sampled: 0,
      invalid: 1,
    });
    await db.execute({
      sql: "UPDATE ea_email_triage SET financial_email_plan_json = ? WHERE user_id = 'user-1'",
      args: [JSON.stringify({ ...plan(), automation: {} })],
    });
    await expect(readFinancialEmailObserveReport("user-1", { dbClient: db })).resolves.toMatchObject({
      sampled: 0, invalid: 1, workflow: { documents: { indexed: 0 }, events: { total: 0 } },
    });
    await db.close();
  });

  it("reports the full owner/window cohort, including unplanned failures and one outcome per event", async () => {
    const db = await createMigratedDb();
    const start = Date.parse("2026-09-07T00:00:00Z");
    const end = Date.parse("2026-09-08T00:00:00Z");
    try {
      const addEvent = async (id: string, {
        status = "settled", planned = true, outcome = null, attempted = false, userId = "user-1", createdAt = start,
      }: { status?: string; planned?: boolean; outcome?: Record<string, unknown> | null; attempted?: boolean; userId?: string; createdAt?: number } = {}) => {
        await db.execute({
          sql: `INSERT INTO ea_financial_events (id, user_id, status, plan_json, outcome_json, operation_json,
                  attempted_at, claim_token, claimed_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, userId, status, planned ? JSON.stringify(plan()) : null,
            outcome ? JSON.stringify(outcome) : null, attempted ? '{"executor":"financial"}' : null,
            attempted ? start : null, status === "processing" ? id : null, status === "processing" ? start : null, createdAt, end - 1],
        });
      };
      const addDocument = async (uid: string, {
        status = "associated", eventId = null, financial = true, error = null, userId = "user-1", createdAt = start,
      }: { status?: string; eventId?: string | null; financial?: boolean; error?: string | null; userId?: string; createdAt?: number } = {}) => {
        await db.execute({
          sql: `INSERT INTO ea_financial_documents (user_id, account_id, email_uid, status, processed_revision,
                  candidate_json, event_id, last_error, claim_token, claimed_at, created_at, updated_at)
                VALUES (?, 'mail', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [userId, uid, status, ["associated", "ignored"].includes(status) ? 1 : 0,
            financial ? '{"type":"expense","amount":30}' : null, eventId, error,
            status === "processing" ? uid : null, status === "processing" ? start : null, createdAt, end - 1],
        });
      };
      await addEvent("recorded", { attempted: true, outcome: { outcome: "added", transactionId: "actual-1" } });
      await addEvent("scheduled", { attempted: true, outcome: { outcome: "updated", scheduleId: "schedule-1" } });
      await addEvent("duplicate", { outcome: { outcome: "already_present", transactionId: "existing" } });
      await addEvent("late-conflict", { status: "needs_review", attempted: true, outcome: { outcome: "already_present", transactionId: "actual-2" } });
      await addEvent("no-write");
      await addEvent("unplanned-wait", { status: "waiting", planned: false });
      await addEvent("unplanned-review", { status: "needs_review", planned: false, outcome: { outcome: "needs_review" } });
      await addEvent("pending", { status: "pending", planned: false });
      await addEvent("processing", { status: "processing", planned: false });
      await addDocument("merchant", { eventId: "recorded" });
      await addDocument("processor", { eventId: "recorded" });
      await addDocument("statement", { eventId: "scheduled" });
      await addDocument("repeated-receipt", { eventId: "duplicate" });
      await addDocument("payment-notice", { eventId: "no-write" });
      await addDocument("planner-failed", { eventId: "unplanned-wait" });
      await addDocument("negative", { status: "ignored", financial: false });
      await addDocument("unassessed", { status: "pending", financial: false });
      await addDocument("assessing", { status: "processing", financial: false });
      await addDocument("assessment-failed", { status: "retry", financial: false, error: "AI unavailable" });
      await addDocument("correlation-unresolved", { status: "retry", error: "Similar receipts remain ambiguous" });

      // Old events stay outside the cohort even when a fresh supporting email
      // arrives or their persisted outcome is updated during this window.
      await addEvent("old-event", { createdAt: start - 1, outcome: { outcome: "added", transactionId: "old-actual" } });
      await addDocument("fresh-followup", { eventId: "old-event" });
      await addEvent("end-boundary", { createdAt: end, outcome: { outcome: "added", transactionId: "tomorrow" } });
      await addEvent("other-owner", { userId: "other", outcome: { outcome: "added", transactionId: "private" } });
      await addDocument("before-window", { createdAt: start - 1 });
      await addDocument("end-boundary", { createdAt: end });
      await addDocument("other-owner", { userId: "other", eventId: "other-owner" });

      await queueEmail(db);
      await queueEmail(db, { uid: "msg-2" });
      await db.execute({ sql: "UPDATE ea_email_triage SET financial_email_plan_json = ? WHERE user_id = 'user-1'", args: [JSON.stringify(plan())] });
      const report = await readFinancialEmailObserveReport("user-1", { dbClient: db, limit: 1, start, end });
      expect(report).toMatchObject({ sampled: 1, truncated: true, writesEnabled: false });
      expect(report.workflow).toEqual({
        window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
        documents: { indexed: 12, assessed: 9, financial: 8, ignored: 1, pending: 1, processing: 1, retry: 2, failed: 2, unplannedFailures: 2 },
        events: { total: 9, pending: 1, processing: 1, waiting: 1, needsReview: 2, settled: 4, planned: 5, unplanned: 4,
          unplannedFailures: 2, attempted: 3, added: 1, updated: 1, alreadyPresent: 2, recorded: 3, scheduled: 1, noWrite: 1 },
      });
      // Reading again preserves the durable result; this report never advances
      // queues, re-assesses documents, or performs Actual work.
      expect((await readFinancialEmailObserveReport("user-1", { dbClient: db, start, end })).workflow).toEqual(report.workflow);
    } finally {
      await db.close();
    }
  });

  it("defaults to a 30-day workflow window and rejects invalid windows", async () => {
    const db = await createMigratedDb();
    try {
      const end = "2026-09-08T00:00:00Z";
      const report = await readFinancialEmailObserveReport("user-1", { dbClient: db, end });
      expect(report.workflow?.window).toEqual({ start: "2026-08-09T00:00:00.000Z", end: "2026-09-08T00:00:00.000Z" });
      await expect(readFinancialEmailObserveReport("user-1", { dbClient: db, start: end, end })).rejects.toThrow(/valid financial report window/);
    } finally {
      await db.close();
    }
  });
});
