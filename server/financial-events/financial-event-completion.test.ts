import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { FinancialEventCompletionEntry, FinancialEventCompletionRequest } from "../../shared/types/financial-operations.ts";
import { createFinancialEventCompletion } from "./financial-event-completion.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";
import { createFinancialEventWorker } from "./financial-event-service.ts";
import { createFinancialEventExecutor, type FinancialEventOperation } from "./financial-event-operation.ts";
import { projectManagedFinancialPlan } from "./financial-event-status.ts";

const DATE = "2026-09-06";
const ARRIVAL = Date.parse(`${DATE}T12:00:00Z`);
const entry: FinancialEventCompletionEntry = { kind: "expense", amount: 12, date: DATE, payee: "Example Market", accountId: "card", categoryId: null, notes: "Owner supplied the missing details" };
const partial: BillCandidate = { type: "expense", event_kind: "purchase", document_role: "merchant_receipt", payee: "Example Market", amount: 12, amount_kind: "transaction_amount", currency: "USD" };

describe("owner completion of managed financial events", () => {
  let db: Client;
  let now: number;
  let store: ReturnType<typeof createFinancialEventStore>;
  let candidates: Map<string, BillCandidate | null>;
  let ledger: Map<string, FinancialEventOperation>;
  let loseResponse: boolean;
  let blockPreview: boolean;
  let assessmentPaused: boolean;
  let metadataUnavailable: boolean;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "054_email_sender_authentication.sql", "062_financial_events.sql"]) {
      await db.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    }
    await db.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at = ?", args: [new Date(ARRIVAL - 60_000).toISOString()] });
    now = ARRIVAL; candidates = new Map(); ledger = new Map(); loseResponse = false; blockPreview = false;
    assessmentPaused = false; metadataUnavailable = false;
    store = createFinancialEventStore(db, () => now);
  });
  afterEach(() => db.close());

  async function arrive(uid = "receipt", candidate: BillCandidate | null = partial, {
    body = "Your purchase total is $12.00.", sender = "receipt@merchant.example", authenticated = false, date = ARRIVAL,
  }: { body?: string; sender?: string; authenticated?: boolean; date?: number } = {}) {
    candidates.set(uid, candidate);
    await db.execute({
      sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email,
              from_name, from_address, subject, body_text, email_date, email_date_utc, indexed_at, sender_authentication_json)
            VALUES (?, 'owner', 'gmail', 'Mail', 'owner@example.test', 'Example Market', ?, 'Receipt', ?, ?, ?, ?, ?)`,
      args: [uid, sender, body, new Date(date).toISOString(), new Date(date).toISOString(), new Date(now).toISOString(),
        JSON.stringify({ status: authenticated ? "pass" : "unavailable" })],
    });
    if (candidate) await db.execute({ sql: "UPDATE ea_financial_documents SET candidate_json = ? WHERE email_uid = ?", args: [JSON.stringify(candidate), uid] });
  }
  async function request(emailUid = "receipt", value = entry): Promise<FinancialEventCompletionRequest> {
    const document = await store.getDocumentForEmail("owner", emailUid);
    const event = await store.getEventForEmail("owner", emailUid);
    return { emailUid, documentRevision: document!.revision, eventRevision: event?.revision ?? null, entry: value };
  }
  function completion() { return createFinancialEventCompletion({ store, now: () => now }); }
  function worker() {
    return createFinancialEventWorker({ store, now: () => now, canRun: async () => false,
      assessDocument: async (_owner, email) => {
        if (assessmentPaused) throw new Error("Financial document assessment is unavailable while email AI is paused or disabled.");
        return candidates.get(email.email_id) || null;
      },
      metadataReader: async () => {
        if (metadataUnavailable) throw new Error("Actual metadata is unavailable");
        return { accounts: [{ id: "card", name: "Visa 1111" }, { id: "checking", name: "Checking 2222" }],
          categories: [], payees: [], payeeMap: {}, schedules: [], recentTransactions: [] };
      },
      afterWrite: async () => {},
      execute: createFinancialEventExecutor({
        financial: async (_owner, input, mode) => {
          const saved = ledger.get(input.identityKey);
          if (mode === "preview") return { outcome: blockPreview ? "needs_review" : saved ? "already_present" : "would_add",
            budgetId: "budget", reason: blockPreview ? "Choose an available account." : "Preview checked" };
          if (mode === "recover") return { outcome: saved ? "already_present" : "needs_review", budgetId: "budget",
            reason: saved ? "Recorded in Actual" : "Previous write is uncertain", transactionId: saved ? "actual-entry" : undefined };
          if (saved || !input.budgetId) throw new Error("Duplicate or unbound Actual dispatch");
          ledger.set(input.identityKey, structuredClone({ executor: "financial", input }));
          if (loseResponse) { loseResponse = false; throw new Error("Response lost after recording"); }
          return { outcome: "added", budgetId: "budget", reason: "Recorded in Actual", transactionId: "actual-entry" };
        },
        transfer: async (_owner, input, mode) => {
          const saved = ledger.get(input.identityKey);
          if (mode === "preview") return { outcome: saved ? "already_scheduled" : "would_create", budgetId: "budget", reason: "Preview checked" };
          if (mode === "recover") return { outcome: saved ? "already_scheduled" : "needs_review", budgetId: "budget", reason: "Recovered schedule" };
          if (saved || !input.budgetId) throw new Error("Duplicate or unbound Actual dispatch");
          ledger.set(input.identityKey, structuredClone({ executor: "transfer_schedule", input }));
          return { outcome: "created", budgetId: "budget", reason: "Scheduled in Actual", scheduleId: "schedule" };
        },
      }),
    });
  }
  async function drainEvent() { now += 90_000; await worker().processNextEvent(); }

  it("records owner-supplied date and account without category, sender authentication, candidate, or enabled AI", async () => {
    await arrive("receipt", null);
    const input = await request();
    const queued = await completion().complete("owner", input);
    expect(queued).toMatchObject({ workflow: { state: "pending", reason: "Owner-confirmed entry queued for Actual.",
      completion: { documentRevision: input.documentRevision + 1, eventRevision: 2, canComplete: false } },
    candidate: { due_date: DATE, amount: 12 }, targets: { account: { id: "card" }, category: { status: "not_applicable" } } });
    expect(await worker().processNextEvent()).toBe(false);
    await drainEvent();
    expect([...ledger.values()]).toEqual([{ executor: "financial", input: {
      kind: "transaction", identityKey: `financial-event:${queued.workflow!.id}`, budgetId: "budget", accountId: "card",
      payee: "Example Market", categoryId: null, amountCents: -1200, date: DATE, notes: entry.notes,
    } }]);
    const saved = await store.getEventForEmail("owner", "receipt");
    expect(saved).toMatchObject({ status: "settled", documents: [{ candidate: null }], ownerCompletion: { documents: [{ candidate: null, revision: 1 }] } });
    await expect(completion().complete("owner", await request())).rejects.toMatchObject({ status: 409 });
  });

  it("rejects unmanaged, cross-owner, invalid and stale requests and admits one concurrent confirmation", async () => {
    await arrive();
    await expect(completion().complete("other", await request())).rejects.toMatchObject({ status: 404 });
    await expect(completion().complete("owner", { ...await request(), emailUid: "unmanaged" })).rejects.toMatchObject({ status: 404 });
    await expect(completion().complete("owner", await request("receipt", { ...entry, date: "2026-02-31" }))).rejects.toMatchObject({ status: 400 });
    await expect(completion().complete("owner", await request("receipt", { ...entry, accountId: "" }))).rejects.toMatchObject({ status: 400 });
    const input = await request();
    const results = await Promise.allSettled([completion().complete("owner", input), completion().complete("owner", input)]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect((await db.execute("SELECT COUNT(*) AS total FROM ea_financial_events")).rows[0]?.total).toBe(1);
    await expect(completion().complete("owner", input)).rejects.toMatchObject({ status: 409 });
    await expect(completion().complete("owner", await request())).rejects.toMatchObject({ status: 409 });
  });

  it("executes owner confirmation while an unrelated new document is waiting for paused AI", async () => {
    await arrive("receipt", null);
    await completion().complete("owner", await request());
    await arrive("newsletter", null, { body: "This week's neighborhood news.", sender: "news@example.test" });
    now += 90_000;
    expect(await worker().processNextEvent()).toBe(false);
    assessmentPaused = true;
    await worker().processNextDocument();
    expect(await store.getDocumentForEmail("owner", "newsletter")).toMatchObject({ status: "retry", processedRevision: 0 });
    await worker().processNextEvent();
    expect((await store.getEventForEmail("owner", "receipt"))?.status).toBe("settled");
    expect(ledger.size).toBe(1);
  });

  it("invalidates an automatic preview claim and refuses confirmation after automatic attempt admission", async () => {
    await arrive();
    const document = await store.claimDocument("assessment");
    await store.associateDocument(document!, { candidate: partial, contentHash: "source", eventId: "existing" });
    const automatic = await store.claimEvent("automatic-preview");
    const queued = await completion().complete("owner", await request());
    expect(queued.workflow?.id).toBe("existing");
    expect(await store.admitOperation(automatic!, { automatic: true })).toBe(false);
    await drainEvent();
    expect(ledger.size).toBe(1);

    await arrive("second");
    const second = await store.claimDocument("second");
    await store.associateDocument(second!, { candidate: partial, contentHash: "second", eventId: "automatic-won" });
    const winner = await store.claimEvent("automatic-won");
    expect(await store.admitOperation(winner!, { automatic: true })).toBe(true);
    await expect(completion().complete("owner", await request("second"))).rejects.toMatchObject({ status: 409 });
  });

  it("allows fresh unattempted corrections after a failed Actual preview while retaining event identity", async () => {
    await arrive();
    const original = await request();
    const queued = await completion().complete("owner", original);
    blockPreview = true;
    await drainEvent();
    let event = await store.getEventForEmail("owner", "receipt");
    expect(projectManagedFinancialPlan(event!.documents[0]!, event)).toMatchObject({ workflow: { state: "needs_review", completion: { canComplete: true } } });
    const corrected = await completion().complete("owner", await request("receipt", { ...entry, accountId: "checking", amount: 15 }));
    expect(corrected.workflow?.id).toBe(queued.workflow?.id);
    expect(corrected.workflow!.completion!.eventRevision).toBeGreaterThan(queued.workflow!.completion!.eventRevision!);
    await expect(completion().complete("owner", original)).rejects.toMatchObject({ status: 409 });
    blockPreview = false;
    await drainEvent();
    event = await store.getEventForEmail("owner", "receipt");
    expect(event).toMatchObject({ status: "settled", ownerCompletion: { entry: { accountId: "checking", amount: 15 } } });
    expect([...ledger.values()][0]).toMatchObject({ input: { accountId: "checking", amountCents: -1500 } });
  });

  it("recovers uncertain writes after restart without rechecking unchanged conflicting extraction or submitting twice", async () => {
    await arrive("receipt", { ...partial, amount: 99, event_kind: "payment_failed" });
    const original = await request();
    await completion().complete("owner", original);
    loseResponse = true;
    await drainEvent();
    const attempted = await store.getEventForEmail("owner", "receipt");
    expect(attempted).toMatchObject({ status: "waiting", attemptedAt: now });
    store = createFinancialEventStore(db, () => now);
    now += 15 * 60_000;
    await worker().processNextEvent();
    expect(await store.getEventForEmail("owner", "receipt")).toMatchObject({ status: "settled", operation: attempted!.operation, ownerCompletion: attempted!.ownerCompletion });
    expect(ledger.size).toBe(1);
    await expect(completion().complete("owner", original)).rejects.toMatchObject({ status: 409 });
    await expect(db.execute("UPDATE ea_financial_events SET owner_completion_json = '{}' WHERE id = '" + attempted!.id + "'")).rejects.toThrow(/immutable/);
  });

  it("pauses for new source changes before dispatch, permits reconfirmation, and preserves a later recorded entry", async () => {
    await arrive();
    await completion().complete("owner", await request());
    await db.execute("UPDATE ea_email_index SET body_text = 'Corrected total $25.00' WHERE uid = 'receipt'");
    await worker().processNextDocument();
    await drainEvent();
    expect(ledger.size).toBe(0);
    expect((await store.getEventForEmail("owner", "receipt"))?.status).toBe("needs_review");
    await completion().complete("owner", await request("receipt", { ...entry, amount: 25 }));
    await drainEvent();
    await db.execute("UPDATE ea_email_index SET body_text = 'Payment cancelled' WHERE uid = 'receipt'");
    await worker().processNextDocument();
    await worker().processNextEvent();
    expect(await store.getEventForEmail("owner", "receipt")).toMatchObject({ status: "needs_review", attemptedAt: expect.any(Number) });
    expect([...ledger.values()]).toMatchObject([{ input: { amountCents: -2500 } }]);
    await expect(completion().complete("owner", await request())).rejects.toMatchObject({ status: 409 });
  });

  it("correlates a late complementary receipt using owner-confirmed facts while preserving original incomplete evidence", async () => {
    const audit: BillCandidate["amount_verification"] = { status: "failed", source_value_count: 2, initial_covered_count: 1 };
    await arrive("receipt", { ...partial, amount: 99, amount_verification: audit, account_last4: "9999" });
    const original = await completion().complete("owner", await request());
    await drainEvent();
    await arrive("processor", { ...partial, document_role: "processor_receipt", due_date: DATE }, {
      body: `Purchase from Example Market. Paid $12.00 on ${DATE}.`, sender: "payment@processor.example", authenticated: true, date: ARRIVAL + 60_000,
    });
    await worker().processNextDocument();
    const related = await store.getEventForEmail("owner", "processor");
    expect(related?.id).toBe(original.workflow?.id);
    const originalCandidate = related!.documents.find((document) => document.emailUid === "receipt")!.candidate;
    expect(originalCandidate?.due_date).toBeUndefined();
    expect(originalCandidate).toMatchObject({ amount: 99, amount_verification: audit, account_last4: "9999" });
    await drainEvent();
    expect(ledger.size).toBe(1);
    expect((await store.getEventForEmail("owner", "processor"))?.status).toBe("settled");
    await db.execute("UPDATE ea_email_index SET body_text = 'Payment cancelled. Corrected total $25.00.' WHERE uid = 'processor'");
    await worker().processNextDocument();
    await worker().processNextEvent();
    expect((await store.getEventForEmail("owner", "processor"))?.status).toBe("needs_review");
    await db.execute("UPDATE ea_email_index SET sender_authentication_json = '{\"status\":\"pass\",\"reason\":\"fresh provider evidence\"}' WHERE uid = 'processor'");
    store = createFinancialEventStore(db, () => now);
    await worker().processNextDocument();
    await worker().processNextEvent();
    expect(await store.getDocumentForEmail("owner", "processor")).toMatchObject({ ownerConfirmationConflict: true });
    expect((await store.getEventForEmail("owner", "processor"))?.status).toBe("needs_review");
    expect(ledger.size).toBe(1);
  });

  it.each([
    { name: "matching account", hint: "Visa 1111", suffix: "1111", confidence: 0.99, unavailable: false, expected: "settled" },
    { name: "different account", hint: "Checking 2222", suffix: "2222", confidence: 0.99, unavailable: false, expected: "needs_review" },
    { name: "unverified account", hint: "Visa 1111", suffix: "1111", confidence: 0.4, unavailable: false, expected: "needs_review" },
    { name: "unavailable account metadata", hint: "Visa 1111", suffix: "1111", confidence: 0.99, unavailable: true, expected: "needs_review" },
  ])("preserves the recorded entry when a later receipt supplies $name evidence", async ({ hint, suffix, confidence, unavailable, expected }) => {
    await arrive();
    const original = await completion().complete("owner", await request());
    await drainEvent();
    const operation = [...ledger.values()][0];
    await arrive("processor", { ...partial, document_role: "processor_receipt", due_date: DATE,
      account_hint: hint, account_hint_confidence: confidence, account_last4: suffix,
      account_last4_evidence: hint, account_last4_confidence: confidence, from_account_hint: hint, from_account_hint_confidence: confidence,
      to_account_hint: "Merchant bank", to_account_hint_confidence: 0.99 }, {
      body: `Paid $12.00 to Example Market on ${DATE} using ${hint}. Recipient: Merchant bank.`, sender: "payment@processor.example", authenticated: true, date: ARRIVAL + 60_000,
    });
    await worker().processNextDocument();
    expect((await store.getEventForEmail("owner", "processor"))?.id).toBe(original.workflow?.id);
    metadataUnavailable = unavailable;
    await drainEvent();
    expect((await store.getEventForEmail("owner", "receipt"))?.status).toBe(expected);
    expect([...ledger.values()]).toEqual([operation]);
  });

  it("requires fresh confirmation when new related funding conflicts before the first dispatch", async () => {
    await arrive();
    await completion().complete("owner", await request());
    await arrive("processor", { ...partial, document_role: "processor_receipt", due_date: DATE,
      account_hint: "Checking 2222", account_hint_confidence: 0.99 }, {
      body: `Paid $12.00 to Example Market on ${DATE} using Checking 2222.`, sender: "payment@processor.example", authenticated: true, date: ARRIVAL + 60_000,
    });
    await worker().processNextDocument();
    await drainEvent();
    expect(ledger.size).toBe(0);
    const event = await store.getEventForEmail("owner", "receipt");
    expect(projectManagedFinancialPlan(event!.documents[0]!, event)).toMatchObject({ workflow: { state: "needs_review", completion: { canComplete: true } } });
  });

  it("registers a newly authenticated original reference and joins a repeat beyond the local time window", async () => {
    const referenced = { ...partial, provider_reference: "ORDER-123", provider_reference_confidence: 0.99, provider_reference_evidence: "ORDER-123" };
    await arrive("receipt", referenced, { body: "Your total is $12.00. Reference ORDER-123." });
    const original = await completion().complete("owner", await request());
    await drainEvent();
    await db.execute("UPDATE ea_email_index SET sender_authentication_json = '{\"status\":\"pass\"}' WHERE uid = 'receipt'");
    await worker().processNextDocument();
    await worker().processNextEvent();
    now += 31 * 86_400_000;
    await arrive("repeat", { ...referenced, due_date: DATE }, { body: `Paid $12.00 on ${DATE}. Reference ORDER-123.`, authenticated: true, date: now });
    await worker().processNextDocument();
    expect((await store.getEventForEmail("owner", "repeat"))?.id).toBe(original.workflow?.id);
    await drainEvent();
    expect(ledger.size).toBe(1);
  });

  it.each(["reward", "refund"] as const)("accepts a later same-reference %s receipt for the confirmed income operation", async (eventKind) => {
    const candidate: BillCandidate = { ...partial, type: "income", event_kind: eventKind,
      provider_reference: "CREDIT-123", provider_reference_confidence: 0.99, provider_reference_evidence: "CREDIT-123" };
    await arrive("receipt", candidate, { body: "Credit $12.00. Reference CREDIT-123.", authenticated: true });
    const original = await completion().complete("owner", await request("receipt", { ...entry, kind: "income" }));
    await drainEvent();
    now += 86_400_000;
    await arrive("repeat", { ...candidate, due_date: DATE, to_account_hint: "Visa 1111", to_account_hint_confidence: 0.99,
      from_account_hint: "Reward issuer", from_account_hint_confidence: 0.99 }, {
      body: `Credit $12.00 on ${DATE} to Visa 1111 from Reward issuer. Reference CREDIT-123.`, authenticated: true, date: now,
    });
    await worker().processNextDocument();
    await drainEvent();
    expect(await store.getEventForEmail("owner", "repeat")).toMatchObject({ id: original.workflow?.id, status: "settled" });
    expect([...ledger.values()]).toMatchObject([{ input: { amountCents: 1200 } }]);
  });

  it.each([
    { kind: "expense", eventKind: "payment_completed" },
    { kind: "bill", eventKind: "payment_due" },
    { kind: "bill", eventKind: "statement_issued" },
    { kind: "transfer", eventKind: "card_payment_completed" },
    { kind: "income", eventKind: "account_transfer_completed" },
  ] as const)("retains a confirmed $kind when a repeat describes the compatible $eventKind subtype", async ({ kind, eventKind }) => {
    const candidate: BillCandidate = { ...partial, type: kind, event_kind: eventKind,
      amount_kind: kind === "bill" ? "total_due" : kind === "transfer" ? "payment_amount" : "transaction_amount",
      provider_reference: "PAYMENT-123", provider_reference_confidence: 0.99, provider_reference_evidence: "PAYMENT-123" };
    await arrive("receipt", candidate, { body: "$12.00. Reference PAYMENT-123.", authenticated: true });
    const original = await completion().complete("owner", await request("receipt", { ...entry, kind, fromAccountId: "checking", toAccountId: "card" }));
    await drainEvent();
    now += 86_400_000;
    await arrive("repeat", { ...candidate, due_date: DATE }, { body: `$12.00 on ${DATE}. Reference PAYMENT-123.`, authenticated: true, date: now });
    await worker().processNextDocument();
    await drainEvent();
    expect(await store.getEventForEmail("owner", "repeat")).toMatchObject({ id: original.workflow?.id, status: "settled" });
    expect(ledger.size).toBe(1);
  });

  it.each([
    { kind: "income", expectedKind: "transaction", expectedCents: 1200 },
    { kind: "bill", expectedKind: "utility_schedule", expectedCents: -1200 },
    { kind: "transfer", expectedKind: "completed_transfer", expectedCents: 1200 },
    { kind: "transfer_schedule", expectedKind: undefined, expectedCents: 1200 },
  ] as const)("queues and records owner-confirmed $kind operations with optional category", async ({ kind, expectedKind, expectedCents }) => {
    await arrive("receipt", null);
    await completion().complete("owner", await request("receipt", { ...entry, kind, fromAccountId: "checking", toAccountId: "card", categoryId: undefined }));
    await drainEvent();
    const operation = [...ledger.values()][0]!;
    expect(operation.input).toMatchObject({ amountCents: expectedCents, date: DATE, budgetId: "budget" });
    if (expectedKind) expect(operation.input).toMatchObject({ kind: expectedKind });
    else expect(operation).toMatchObject({ executor: "transfer_schedule", input: { name: "Transfer payment" } });
  });
});
