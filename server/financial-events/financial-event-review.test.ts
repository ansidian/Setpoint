import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillCandidate, FinancialEmailPlan, FinancialPlanReasonCode } from "../../shared/types/bills.ts";
import { createFinancialEventCompletion } from "./financial-event-completion.ts";
import { ownerCompletionPlan } from "./financial-event-completion-model.ts";
import { listFinancialEventReview, readFinancialReviewChanges } from "./financial-event-review.ts";
import { resolveManagedFinancialPlan } from "./financial-event-status.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";

const OWNER = "owner";
const RECEIVED_AT = "2026-09-06T12:00:00Z";
const DETAILS_REASON = "Waiting for an explicit transaction or payment date.";
const candidate: BillCandidate = { type: "expense", event_kind: "purchase", payee: "Example Market",
  amount: 12, amount_kind: "transaction_amount", currency: "USD", notes: "PRIVATE ASSESSMENT", event_evidence: "PRIVATE SOURCE EVIDENCE" };
const entry = { kind: "expense" as const, amount: 14, date: "2026-09-06", payee: "Confirmed Merchant", accountId: "card" };

function blockedPlan(codes: FinancialPlanReasonCode[]): FinancialEmailPlan {
  return { ...ownerCompletionPlan("event", entry), candidate,
    reviewReasons: codes.map((code) => ({ code, message: "Provider wording may change", blocking: true })) };
}

describe("durable financial event review projection", () => {
  let db: Client;
  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "054_email_sender_authentication.sql", "062_financial_events.sql"]) {
      await db.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    }
    await db.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2026-01-01T00:00:00Z'");
  });
  afterEach(() => db.close());

  async function source(uid: string, { owner = OWNER, value = candidate, status = "retry", reason = DETAILS_REASON, createdAt = 1000, updatedAt = createdAt }:
    { owner?: string; value?: BillCandidate | null; status?: "pending" | "retry" | "ignored"; reason?: string; createdAt?: number; updatedAt?: number } = {}) {
    await db.execute({ sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email,
      from_name, from_address, subject, body_text, email_date, email_date_utc, indexed_at)
      VALUES (?, ?, 'gmail', 'Mail', 'owner@example.test', 'Example Market', 'receipts@example.test', ?, 'PRIVATE FULL BODY', ?, ?, ?)`,
    args: [uid, owner, `Receipt ${uid}`, RECEIVED_AT, RECEIVED_AT, RECEIVED_AT] });
    await db.execute({ sql: `UPDATE ea_financial_documents SET status = ?, candidate_json = ?, last_error = ?,
      created_at = ?, updated_at = ?, next_attempt_at = 50000, processed_revision = revision WHERE user_id = ? AND email_uid = ?`,
    args: [status, value ? JSON.stringify(value) : null, reason, createdAt, updatedAt, owner, uid] });
  }

  async function event(id: string, { owner = OWNER, uids = [id], state = "waiting", reason = DETAILS_REASON,
    createdAt = 1000, updatedAt = createdAt, plan = null, attempted = false, outcome = null, confirmed = false }:
    { owner?: string; uids?: string[]; state?: "waiting" | "needs_review" | "pending" | "settled";
      reason?: string; createdAt?: number; updatedAt?: number; plan?: FinancialEmailPlan | null;
      attempted?: boolean; outcome?: string | null; confirmed?: boolean } = {}) {
    for (const uid of uids) await source(uid, { owner });
    await db.execute({ sql: `INSERT INTO ea_financial_events (id, user_id, status, reason, created_at, updated_at,
      next_attempt_at, plan_json, attempted_at, operation_json, outcome_json, owner_completion_json)
      VALUES (?, ?, ?, ?, ?, ?, 50000, ?, ?, ?, ?, ?)`,
    args: [id, owner, state, reason, createdAt, updatedAt, plan ? JSON.stringify(plan) : null,
      attempted ? 2000 : null, attempted ? JSON.stringify({ executor: "financial", input: { budgetId: "budget" } }) : null,
      outcome ? JSON.stringify({ outcome }) : null,
      confirmed ? JSON.stringify({ version: 1, id: "confirmation", submittedAt: 2000, entry, documents: [] }) : null] });
    for (const uid of uids) await db.execute({ sql: "UPDATE ea_financial_documents SET event_id = ?, status = 'associated' WHERE user_id = ? AND email_uid = ?", args: [id, owner, uid] });
  }

  const queue = (offset = 0) => listFinancialEventReview(OWNER, { offset, dbClient: db });

  it("groups related receipts, keeps known financial retries, and excludes other owners, negatives and unassessed failures", async () => {
    await event("shared", { uids: ["processor-receipt", "merchant-receipt"], createdAt: 100 });
    await source("known-retry", { reason: "Waiting for evidence that distinguishes similar purchases.", createdAt: 200 });
    await source("unknown-retry", { value: null, reason: "Financial assessment will retry: API is unavailable" });
    await source("pending", { status: "pending" });
    await source("negative", { status: "ignored", value: null });
    await event("queued", { state: "pending" });
    await event("done", { state: "settled" });
    await event("another-owner", { owner: "other" });
    await source("another-owner-retry", { owner: "other" });

    const response = await queue();
    expect(response).toEqual({ items: [
      { id: expect.stringMatching(/^document:/), emailUid: "known-retry", subject: "Receipt known-retry", from: "Example Market",
        receivedAt: RECEIVED_AT, payee: "Example Market", amount: 12, currency: "USD", state: "waiting",
        reason: "Waiting for evidence that distinguishes similar purchases.", relatedEmails: 1, createdAt: 200, nextAttemptAt: 50000,
        canComplete: true, attention: "complete_details" },
      { id: "event:shared", emailUid: "processor-receipt", subject: "Receipt processor-receipt", from: "Example Market",
        receivedAt: RECEIVED_AT, payee: "Example Market", amount: 12, currency: "USD", state: "waiting", reason: DETAILS_REASON,
        relatedEmails: 2, createdAt: 100, nextAttemptAt: 50000, canComplete: true, attention: "complete_details" },
    ], total: 2, offset: 0, limit: 20 });
    expect(JSON.stringify(response)).not.toContain("PRIVATE");
    expect((await readFinancialReviewChanges(OWNER, { dbClient: db })).items.map((item) => item.emailUid))
      .toEqual(["processor-receipt", "known-retry"]);
  });

  it("uses the oldest available source and never links an absent or differently owned index row", async () => {
    await event("related", { uids: ["gone", "available"] });
    await event("unavailable");
    await event("changed-owner");
    await db.execute("DELETE FROM ea_email_index WHERE uid IN ('gone', 'unavailable')");
    await db.execute("UPDATE ea_email_index SET user_id = 'other' WHERE uid = 'changed-owner'");
    expect(await queue()).toMatchObject({ total: 1, items: [{ id: "event:related", emailUid: "available", relatedEmails: 2 }] });
  });

  it("paginates events by original creation time with a matching total even beyond the last page", async () => {
    for (let index = 0; index < 22; index++) await event(`event-${String(index).padStart(2, "0")}`, { createdAt: index });
    const first = await queue();
    expect(first.items).toHaveLength(20);
    expect(first.items.map((item) => item.emailUid)).toEqual(Array.from({ length: 20 }, (_, index) => `event-${String(21 - index).padStart(2, "0")}`));
    expect(first.total).toBe(22);
    expect(await queue(20)).toMatchObject({ items: [{ emailUid: "event-01" }, { emailUid: "event-00" }], total: 22, offset: 20, limit: 20 });
    expect(await queue(40)).toEqual({ items: [], total: 22, offset: 40, limit: 20 });
    await db.execute("UPDATE ea_financial_events SET updated_at = 99999, attempts = 12 WHERE id = 'event-00'");
    expect((await queue()).items[0]!.emailUid).toBe("event-21");
  });

  it("separates detail blockers, Actual conflicts and automatic retries without using category or arbitrary wording", async () => {
    const missingAccount = blockedPlan(["account_target_unresolved"]);
    await event("missing-account", { plan: missingAccount, reason: "An account must be selected." });
    await event("missing-date");
    await event("source-conflict", { state: "needs_review", confirmed: true, reason: "New source details arrived after your confirmation. Review and confirm the entry again." });
    await event("actual-conflict", { state: "needs_review", outcome: "needs_review", reason: "Multiple existing Actual transactions match this event." });
    await event("attempted-conflict", { state: "needs_review", attempted: true, reason: "Source details changed after recording." });
    await event("already-recorded", { state: "needs_review", outcome: "already_present" });
    await event("recorded-plan", { state: "needs_review", plan: { ...missingAccount,
      reconciliation: { ...missingAccount.reconciliation, status: "already_recorded" } } });
    await event("category", { plan: blockedPlan(["category_target_unresolved"]), reason: "A category could not be selected." });
    await event("unknown", { reason: "An external check is still running." });
    await event("stale-account", { plan: missingAccount, reason: "Financial processing will retry: Actual is offline" });
    await event("provider", { plan: blockedPlan(["actual_metadata_unavailable", "account_target_unresolved"]), reason: "An account must be selected." });
    await event("fresh-conflict", { plan: blockedPlan(["actual_metadata_unavailable"]), reason: "Related emails contain conflicting payment details." });
    await event("paused", { plan: missingAccount, reason: "Financial processing is paused while email AI is disabled." });
    await event("recovery", { attempted: true, plan: missingAccount, reason: "Verifying the previous Actual operation: sync timed out" });
    await source("auth", { reason: "Waiting for verified sender authentication." });
    await source("assessment", { reason: "Financial assessment will retry: API is offline" });

    const items = (await queue()).items;
    const byUid = new Map(items.map((item) => [item.emailUid, item]));
    for (const uid of ["missing-account", "missing-date", "source-conflict", "fresh-conflict"]) {
      expect(byUid.get(uid)).toMatchObject({ attention: "complete_details", canComplete: true });
    }
    expect(byUid.get("actual-conflict")).toMatchObject({ attention: "check_actual", canComplete: true });
    for (const uid of ["attempted-conflict", "already-recorded", "recorded-plan"]) {
      expect(byUid.get(uid)).toMatchObject({ attention: "check_actual", canComplete: false });
    }
    for (const uid of ["category", "unknown", "stale-account", "provider", "paused", "recovery", "auth", "assessment"]) {
      expect(byUid.get(uid)?.attention).toBe("retrying");
    }
    expect((await readFinancialReviewChanges(OWNER, { dbClient: db })).items.map((item) => item.emailUid).sort())
      .toEqual(["actual-conflict", "already-recorded", "attempted-conflict", "fresh-conflict", "missing-account", "missing-date", "recorded-plan", "source-conflict"]);
  });

  it("advances a changes cursor over silent rows and all timestamp ties before returning a later alert", async () => {
    for (let index = 0; index < 50; index++) await event(`silent-${String(index).padStart(2, "0")}`, { reason: "Financial processing will retry: unavailable", updatedAt: 1000 });
    await event("z-attention", { updatedAt: 1000 });
    const first = await readFinancialReviewChanges(OWNER, { dbClient: db });
    expect(first).toEqual({ items: [], cursor: { updatedAt: 1000, id: "event:silent-49" }, hasMore: true });
    const second = await readFinancialReviewChanges(OWNER, { dbClient: db, after: first.cursor! });
    expect(second).toEqual({ items: [{ key: expect.stringMatching(/^financial-review:/), emailUid: "z-attention" }],
      cursor: { updatedAt: 1000, id: "event:z-attention" }, hasMore: false });
    expect(await readFinancialReviewChanges(OWNER, { dbClient: db, after: second.cursor! }))
      .toEqual({ items: [], cursor: second.cursor, hasMore: false });
    expect((await readFinancialReviewChanges(OWNER, { dbClient: db, after: { updatedAt: 1000, id: "" } })).hasMore).toBe(true);
  });

  it("finds newly actionable old events and keeps notification identity stable across retries, wording, category and association", async () => {
    await source("old-email", { createdAt: 1, updatedAt: 1000, reason: "Waiting for evidence that distinguishes similar purchases." });
    const original = await readFinancialReviewChanges(OWNER, { dbClient: db });
    const store = createFinancialEventStore(db, () => 2000);
    await db.execute("INSERT INTO ea_financial_events (id, user_id, status, created_at, updated_at) VALUES ('old-event', 'owner', 'waiting', 1, 2000)");
    await db.execute("UPDATE ea_financial_documents SET event_id = 'old-event', status = 'associated' WHERE email_uid = 'old-email'");
    const associated = await store.getEventForEmail(OWNER, "old-email");
    await db.execute({ sql: "UPDATE ea_financial_events SET status = 'waiting', reason = ?, updated_at = 3000 WHERE id = ?", args: [DETAILS_REASON, associated!.id] });
    const reassociated = await readFinancialReviewChanges(OWNER, { dbClient: db, after: original.cursor! });
    expect(reassociated.items).toEqual(original.items);
    await db.execute({ sql: "UPDATE ea_financial_events SET status = 'processing', claim_token = 'retry', claimed_at = 4000, updated_at = 4000 WHERE id = ?", args: [associated!.id] });
    expect((await readFinancialReviewChanges(OWNER, { dbClient: db, after: reassociated.cursor! })).items).toEqual([]);
    const newPlan = blockedPlan(["account_target_unresolved", "category_target_unresolved"]);
    await db.execute({ sql: `UPDATE ea_financial_events SET status = 'waiting', claim_token = NULL, claimed_at = NULL,
      revision = revision + 1, reason = 'The wording changed', plan_json = ?, updated_at = 5000 WHERE id = ?`, args: [JSON.stringify(newPlan), associated!.id] });
    const retried = await readFinancialReviewChanges(OWNER, { dbClient: db, after: reassociated.cursor! });
    expect(retried.items).toEqual(original.items);
    await db.execute({ sql: "UPDATE ea_financial_events SET status = 'needs_review', outcome_json = ?, updated_at = 6000 WHERE id = ?",
      args: [JSON.stringify({ outcome: "needs_review" }), associated!.id] });
    const actualCheck = await readFinancialReviewChanges(OWNER, { dbClient: db, after: retried.cursor! });
    expect(actualCheck.items[0]!.emailUid).toBe("old-email");
    expect(actualCheck.items[0]!.key).not.toBe(original.items[0]!.key);
    await db.execute({ sql: "UPDATE ea_financial_events SET status = 'settled', updated_at = 7000 WHERE id = ?", args: [associated!.id] });
    expect(await readFinancialReviewChanges(OWNER, { dbClient: db, after: actualCheck.cursor! })).toEqual({ items: [], cursor: actualCheck.cursor, hasMore: false });
  });

  it("alerts once when a new owner confirmation reopens the same required action", async () => {
    await event("reopened");
    let previous = await readFinancialReviewChanges(OWNER, { dbClient: db });
    for (const now of [2000, 4000]) {
      const store = createFinancialEventStore(db, () => now);
      const status = await resolveManagedFinancialPlan(OWNER, "reopened", { dbClient: db });
      await createFinancialEventCompletion({ store, now: () => now }).complete(OWNER, { ...status!.workflow!.completion, entry });
      expect((await readFinancialReviewChanges(OWNER, { dbClient: db, after: previous.cursor! })).items).toEqual([]);
      await db.execute({ sql: `UPDATE ea_financial_events SET status = 'needs_review', updated_at = ?,
        reason = 'New source details arrived after your confirmation. Review and confirm the entry again.' WHERE id = 'reopened'`, args: [now + 500] });
      const reopened = await readFinancialReviewChanges(OWNER, { dbClient: db, after: previous.cursor! });
      expect((await queue()).items[0]).toMatchObject({ emailUid: "reopened", attention: "complete_details", canComplete: true });
      expect(reopened.items[0]!.key).not.toBe(previous.items[0]!.key);
      await db.execute({ sql: `UPDATE ea_financial_events SET updated_at = ?, revision = revision + 1,
        reason = 'The explanation changed after another check.' WHERE id = 'reopened'`, args: [now + 600] });
      expect((await readFinancialReviewChanges(OWNER, { dbClient: db, after: reopened.cursor! })).items).toEqual(reopened.items);
      previous = reopened;
    }
  });

  it("opens fresh completion through the primary email, then removes the queued entry without writing to Actual", async () => {
    await event("incomplete", { uids: ["primary", "complementary"] });
    const item = (await queue()).items[0]!;
    const status = await resolveManagedFinancialPlan(OWNER, item.emailUid, { dbClient: db });
    expect(status!.workflow!.completion).toMatchObject({ emailUid: "primary", canComplete: item.canComplete });
    const store = createFinancialEventStore(db, () => 2000);
    await createFinancialEventCompletion({ store, now: () => 2000 }).complete(OWNER, { ...status!.workflow!.completion, entry });
    expect(await queue()).toEqual({ items: [], total: 0, offset: 0, limit: 20 });
    expect(await store.getEventForEmail(OWNER, item.emailUid)).toMatchObject({ status: "pending", attemptedAt: null, operation: null });
    await db.execute("UPDATE ea_financial_events SET status = 'waiting' WHERE id = 'incomplete'");
    expect((await queue()).items[0]).toMatchObject({ amount: 14, payee: "Confirmed Merchant", currency: "USD" });
  });

  it("reports canonical amounts without inventing a total, currency or merchant", async () => {
    await source("statement", { value: { event_kind: "statement_issued", amount: 3, amount_kind: "minimum_due", currency: "USD",
      amount_candidates: [{ value: 3, kind: "minimum_due" }, { value: 47, kind: "statement_balance" }] } });
    await source("missing", { value: { type: "expense", event_kind: "purchase" } });
    const items = (await queue()).items;
    expect(items.find((item) => item.emailUid === "statement")).toMatchObject({ amount: 47, currency: "USD", payee: null });
    expect(items.find((item) => item.emailUid === "missing")).toMatchObject({ amount: null, currency: null, payee: null });
  });

  it("returns empty cursors and rejects invalid pagination without changing owner state", async () => {
    expect(await readFinancialReviewChanges(OWNER, { dbClient: db })).toEqual({ items: [], cursor: null, hasMore: false });
    expect(await queue()).toEqual({ items: [], total: 0, offset: 0, limit: 20 });
    for (const offset of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(queue(offset)).rejects.toMatchObject({ status: 400 });
    }
    await expect(readFinancialReviewChanges(OWNER, { dbClient: db, after: { updatedAt: -1, id: "event:x" } }))
      .rejects.toMatchObject({ status: 400 });
  });
});
