import { resolveManagedFinancialPlan } from "./financial-event-status.ts";
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillCandidate, FinancialEmailPlan } from "../../shared/types/bills.ts";
import type { FinancialEventCompletionEntry, FinancialEventCompletionRequest } from "../../shared/types/financial-operations.ts";
import { createFinancialEventCompletion } from "./financial-event-completion.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";
import { createFinancialEventWorker } from "./financial-event-service.ts";
import { createFinancialEventExecutor, type FinancialEventOperation } from "./financial-event-operation.ts";
import { projectManagedFinancialPlan } from "./financial-event-status.ts";
import { readFinancialProfiles } from "../bills/financial-profiles.ts";
import type { FinancialEmailSource } from "../email/financial-email-source.ts";
import type { EmailAuthenticationProjection } from "../../shared/types/email.ts";

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
  let providerSources: Map<string, FinancialEmailSource>;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "054_email_sender_authentication.sql", "062_financial_events.sql", "068_financial_candidate_dismissal.sql", "067_financial_event_ai_requests.sql", "069_financial_profiles.sql", "070_financial_document_sources.sql"]) {
      await db.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    }
    await addFinancialCorrectionSchema(db);
    await db.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at = ?", args: [new Date(ARRIVAL - 60_000).toISOString()] });
    now = ARRIVAL; candidates = new Map(); providerSources = new Map(); ledger = new Map(); loseResponse = false; blockPreview = false;
    assessmentPaused = false; metadataUnavailable = false;
    store = createFinancialEventStore(db, () => now);
  });
  afterEach(() => db.close());

  async function arrive(uid = "receipt", candidate: BillCandidate | null = partial, {
    body = "Your purchase total is $12.00.", sender = "receipt@merchant.example", authenticated = false, date = ARRIVAL,
  }: { body?: string; sender?: string; authenticated?: boolean; date?: number } = {}) {
    candidates.set(uid, candidate);
    providerSources.set(uid, { body, fromName: "Example Market", fromAddress: sender, subject: "Receipt",
      emailDate: new Date(date).toISOString(), threadId: null, messageId: null, attachments: [],
      senderAuthentication: { status: authenticated ? "pass" : "unavailable" } as EmailAuthenticationProjection });
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
  async function authorizeAutomaticEntry(): Promise<FinancialEmailPlan> {
    await db.execute({
      sql: "INSERT INTO ea_settings (user_id, actual_budget_sync_id, financial_profiles_json, financial_profiles_revision) VALUES (?, ?, ?, ?)",
      args: ["owner", "budget", JSON.stringify([{ id: "market", name: "Market receipts", enabled: true, budgetId: "budget",
        senderAddresses: ["receipt@merchant.example"], target: { kind: "expense", accountId: "card", payeeId: "market" } }]), 1],
    });
    return {
      version: 1, identity: { version: 1, status: "resolved", key: "financial-email:fixture" }, candidate: partial,
      profile: { status: "matched", revision: 1, budgetId: "budget", profileId: "market", reason: "Confirmed market profile" },
      classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 0.99, reasons: [] },
      operation: { intended: "create_transaction", kind: "create_transaction", reasons: [] },
      targets: {
        account: { kind: "account", status: "resolved", id: "card", provenance: [] },
        payee: { kind: "payee", status: "resolved", id: "market", provenance: [] },
        category: { kind: "category", status: "not_applicable", provenance: [] },
        fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
        toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
        schedule: { kind: "schedule", status: "not_applicable", provenance: [] },
      },
      reconciliation: { status: "not_scheduled", disposition: "create" }, reviewReasons: [],
      automation: { eligible: true, operationClass: "one_time_expense", rollout: "enabled", gates: [], reasons: [] },
    };
  }
  function worker() {
    return createFinancialEventWorker({ store, now: () => now, canRun: async () => !assessmentPaused,
      profileReader: (userId) => readFinancialProfiles(userId, { dbClient: db }),
      sourceAcquirer: async (_userId, uid) => structuredClone(providerSources.get(uid)!),
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
  async function drainEvent() { await worker().processNextEvent(); }

  it("dismisses an unassociated candidate durably without deleting its source or permitting resubmission", async () => {
    await arrive();
    const original = await request();
    const result = await completion().dismiss("owner", original);
    expect(result.workflow).toMatchObject({ dismissed: true, completion: { canComplete: false, canDismiss: false } });
    await expect(completion().dismiss("owner", original)).resolves.toMatchObject({ workflow: { dismissed: true } });
    await expect(completion().complete("owner", await request())).rejects.toMatchObject({ status: 409 });
    await db.execute("UPDATE ea_email_index SET body_text = 'Updated source after dismissal' WHERE uid = 'receipt'");
    await worker().recoverStaleClaims();
    expect(await worker().processNextDocument()).toBe(false);
    expect(await worker().processNextEvent()).toBe(false);
    expect((await store.getDocumentForEmail("owner", "receipt"))?.body).toBe("Updated source after dismissal");
    expect(ledger.size).toBe(0);
  });

  it("dismisses every linked source and invalidates a concurrent automatic preview", async () => {
    const plan = await authorizeAutomaticEntry();
    await arrive(); await arrive("related");
    for (const token of ["one", "two"]) {
      const document = await store.claimDocument(token);
      await store.associateDocument(document!, { candidate: partial, contentHash: "source", eventId: "existing", nextAttemptAt: now });
    }
    const claim = await store.claimEvent("automatic");
    await completion().dismiss("owner", await request());
    expect(await store.admitOperation(claim!, { test: true }, plan)).toBe(false);
    const event = await store.getEventForEmail("owner", "receipt");
    expect(event?.dismissedAt).toBe(now);
    expect(event?.documents.map(doc => doc.dismissedAt)).toEqual([now, now]);
    await db.execute("UPDATE ea_email_index SET body_text = 'Changed' WHERE uid = 'related'");
    expect(await worker().processNextDocument()).toBe(false);
    expect(await worker().processNextEvent()).toBe(false);
    expect(await store.getNextWakeAt()).toBeNull();
  });

  it("suppresses fresh same-reference receipts after dismissing an unassociated source, even after source changes", async () => {
    const candidate = { ...partial, due_date: DATE, provider_reference: "ORDER-104", provider_reference_confidence: 0.99,
      provider_reference_evidence: "Order ORDER-104" };
    const body = `Order ORDER-104. Paid $12.00 on ${DATE}.`;
    await arrive("receipt", candidate, { body, authenticated: true });
    await completion().dismiss("owner", await request());
    const original = await store.getEventForEmail("owner", "receipt");
    expect(original).toMatchObject({ dismissedAt: now, ownerCompletion: null, operation: null });
    await db.execute("UPDATE ea_email_index SET body_text = 'Changed source without the original reference' WHERE uid = 'receipt'");
    now += 86400_000;
    await arrive("fresh", candidate, { body, authenticated: true, date: now });
    expect(await worker().processNextDocument()).toBe(true);
    const related = await store.getEventForEmail("owner", "fresh");
    expect(related?.id).toBe(original?.id);
    expect(projectManagedFinancialPlan((await store.getDocumentForEmail("owner", "fresh"))!, related).workflow)
      .toMatchObject({ dismissed: true, completion: { canComplete: false, canDismiss: false } });
    expect(await worker().processNextDocument()).toBe(false);
    expect(await worker().processNextEvent()).toBe(false);
    expect(await store.getNextWakeAt()).toBeNull();
    expect(ledger.size).toBe(0);
  });

  it("rejects an existing reference and a changed standalone source without creating dismissal orphans", async () => {
    const candidate = { ...partial, provider_reference: "ORDER-104", provider_reference_confidence: 0.99,
      provider_reference_evidence: "Order ORDER-104" };
    await arrive("receipt", candidate, { body: "Order ORDER-104", authenticated: true });
    await completion().dismiss("owner", await request());
    await arrive("conflicting", candidate, { body: "Order ORDER-104", authenticated: true });
    await expect(completion().dismiss("owner", await request("conflicting"))).rejects.toMatchObject({ status: 409 });
    expect(await store.getEventForEmail("owner", "conflicting")).toBeNull();
    const stale = (await store.getDocumentForEmail("owner", "conflicting"))!;
    await db.execute("UPDATE ea_email_index SET body_text = 'Changed' WHERE uid = 'conflicting'");
    expect(await store.dismissCandidate(stale, null, { eventId: "stale-dismissal", referenceKey: null })).toBe(false);
    expect((await db.execute("SELECT COUNT(*) AS total FROM ea_financial_events")).rows[0]?.total).toBe(1);
  });

  it("rejects stale, malformed, other-owner and already-submitted dismissals", async () => {
    await arrive();
    const original = await request();
    await expect(completion().dismiss("other", original)).rejects.toMatchObject({ status: 404 });
    await expect(completion().dismiss("owner", { ...original, documentRevision: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(completion().dismiss("owner", { ...original, documentRevision: 20 })).rejects.toMatchObject({ status: 409 });
    await completion().complete("owner", original);
    await expect(completion().dismiss("owner", await request())).rejects.toMatchObject({ status: 409 });
    await drainEvent();
    await expect(completion().dismiss("owner", await request())).rejects.toMatchObject({ status: 409 });
    expect(ledger.size).toBe(1);
  });

  it("records owner-supplied date and account without category, sender authentication, candidate, or enabled AI", async () => {
    assessmentPaused = true;
    await arrive("receipt", null);
    const input = await request();
    const queued = await completion().complete("owner", input);
    expect(queued).toMatchObject({ workflow: { state: "pending", reason: "Owner-confirmed entry queued for Actual.",
      completion: { documentRevision: input.documentRevision + 1, eventRevision: 2, canComplete: false } },
    candidate: { due_date: DATE, amount: 12 }, targets: { account: { id: "card" }, category: { status: "not_applicable" } } });
    expect(await worker().processNextEvent()).toBe(true);
    expect([...ledger.values()]).toEqual([{ executor: "financial", input: {
      kind: "transaction", identityKey: `financial-event:${queued.workflow!.id}`, budgetId: "budget", accountId: "card",
      payee: "Example Market", categoryId: null, amountCents: -1200, date: DATE, notes: entry.notes,
    } }]);
    const saved = await store.getEventForEmail("owner", "receipt");
    expect(saved).toMatchObject({ status: "settled", documents: [{ candidate: null }], ownerCompletion: { documents: [{ candidate: null, revision: 1 }] } });
    await expect(completion().complete("owner", await request())).rejects.toMatchObject({ status: 409 });
  });

  it("closes the automatic collection window at confirmation, but waits for capture through that instant", async () => {
    await arrive();
    const document = await store.claimDocument("assessment");
    await store.associateDocument(document!, { candidate: partial, contentHash: "source", eventId: "existing", nextAttemptAt: now + 90_000 });
    await db.execute({ sql: `INSERT INTO ea_financial_intake_state (user_id, account_id, completed_through, status, next_attempt_at, updated_at)
      VALUES ('owner', 'gmail', ?, 'waiting', ?, ?)`, args: [new Date(now - 1000).toISOString(), now + 300_000, now] });
    const queued = await completion().complete("owner", await request());
    expect(queued.workflow?.nextAttemptAt).toBe(now);
    expect(queued.workflow?.progress).toBe('checking_emails');
    expect((await store.getEventForEmail("owner", "receipt"))?.collectionDeadline).toBe(now);
    expect(await worker().processNextEvent()).toBe(false);
    expect(ledger.size).toBe(0);
    await db.execute({ sql: "UPDATE ea_financial_intake_state SET completed_through = ?", args: [new Date(now).toISOString()] });
    expect((await resolveManagedFinancialPlan('owner', 'receipt', { dbClient: db }))?.workflow?.progress).toBe('queued');
    expect(await worker().processNextEvent()).toBe(true);
    expect((await store.getEventForEmail("owner", "receipt"))?.status).toBe("settled");
    expect(ledger.size).toBe(1);
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
    const plan = await authorizeAutomaticEntry();
    await arrive();
    const document = await store.claimDocument("assessment");
    await store.associateDocument(document!, { candidate: partial, contentHash: "source", eventId: "existing" });
    const automatic = await store.claimEvent("automatic-preview");
    const queued = await completion().complete("owner", await request());
    expect(queued.workflow?.id).toBe("existing");
    expect(await store.admitOperation(automatic!, { automatic: true }, plan)).toBe(false);
    await drainEvent();
    expect(ledger.size).toBe(1);

    await arrive("second");
    const second = await store.claimDocument("second");
    await store.associateDocument(second!, { candidate: partial, contentHash: "second", eventId: "automatic-won" });
    const winner = await store.claimEvent("automatic-won");
    expect(await store.admitOperation(winner!, { automatic: true }, plan)).toBe(true);
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
    { kind: "expense", eventKind: "payment_completed", ignored: false },
    { kind: "bill", eventKind: "payment_due", ignored: true },
    { kind: "bill", eventKind: "statement_issued", ignored: false },
    { kind: "transfer", eventKind: "card_payment_completed", ignored: true },
    { kind: "income", eventKind: "account_transfer_completed", ignored: false },
  ] as const)("retains a confirmed $kind when a repeat describes the $eventKind subtype", async ({ kind, eventKind, ignored }) => {
    const candidate: BillCandidate = { ...partial, type: kind, event_kind: eventKind,
      amount_kind: kind === "bill" ? "total_due" : kind === "transfer" ? "payment_amount" : "transaction_amount",
      provider_reference: "PAYMENT-123", provider_reference_confidence: 0.99, provider_reference_evidence: "PAYMENT-123" };
    await arrive("receipt", candidate, { body: "$12.00. Reference PAYMENT-123.", authenticated: true });
    const original = await completion().complete("owner", await request("receipt", { ...entry, kind, fromAccountId: "checking", toAccountId: "card" }));
    await drainEvent();
    const recorded = [...ledger.values()];
    now += 86_400_000;
    await arrive("repeat", { ...candidate, due_date: DATE }, { body: `$12.00 on ${DATE}. Reference PAYMENT-123.`, authenticated: true, date: now });
    await worker().processNextDocument();
    await drainEvent();
    if (ignored) {
      expect(await store.getDocumentForEmail("owner", "repeat")).toMatchObject({ status: "ignored", eventId: null });
      expect(await store.getEventForEmail("owner", "repeat")).toBeNull();
    } else expect(await store.getEventForEmail("owner", "repeat")).toMatchObject({ id: original.workflow?.id, status: "settled" });
    expect(await store.getEventForEmail("owner", "receipt")).toMatchObject({ id: original.workflow?.id, status: "settled" });
    expect(recorded).toHaveLength(1);
    expect([...ledger.values()]).toEqual(recorded);
  });

  it("projects a corrected schedule as a recorded ledger entry while retaining the original managed outcome", async () => {
    await arrive("receipt", null);
    const completed = await completion().complete("owner", await request("receipt", { ...entry, kind: 'bill' }));
    await drainEvent();
    const eventId = completed.workflow!.id;
    const original = await store.getEventForEmail('owner', 'receipt');
    const occurrence = await db.execute({ sql: "SELECT activity_id FROM ea_financial_activity_occurrences WHERE owner='event' AND record_id=?", args: [eventId] });
    const activityId = String(occurrence.rows[0]!.activity_id);
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('preview','owner',?,'{}',1)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at) VALUES ('correction','owner',?,'budget','preview','key','completed',?,2)", args: [activityId, JSON.stringify({ entry: { kind:'expense', type:'payment', amount:15, amountCents:1500, date:DATE, accountId:'checking', payee:'Corrected merchant' } })] });
    expect(await resolveManagedFinancialPlan('owner','receipt',{ dbClient:db })).toMatchObject({
      candidate: { type:'expense', amount:15, payee:'Corrected merchant' },
      operation: { kind:'no_write', intended:'create_transaction' },
      reconciliation: { status:'already_recorded' },
      workflow: { correction: { id:'correction', state:'completed', revision:1 }, completion: { canComplete:false } },
    });
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('next-preview','owner',?,'{}',3)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,updated_at) VALUES ('next','owner',?,'budget','next-preview','next-key','recovering',3)", args: [activityId] });
    expect(await resolveManagedFinancialPlan('owner','receipt',{ dbClient:db })).toMatchObject({
      candidate: { amount:15 }, workflow: { correction: { id:'next', state:'recovering' }, completion: { canComplete:false } },
    });
    expect((await store.getEventForEmail('owner','receipt'))?.outcome).toEqual(original?.outcome);
  });

  it.each([undefined, { kind: 'income', type: 'income', amount: 37, amountCents: 3700, date: DATE, accountId: 'checking', payee: 'Observed merchant' }])('keeps only observed managed entry facts after owner acceptance: %j', async (keptEntry) => {
    await arrive("receipt", null);
    const completed = await completion().complete("owner", await request("receipt", { ...entry, kind: 'bill' }));
    await drainEvent();
    const occurrence = await db.execute({ sql: "SELECT activity_id FROM ea_financial_activity_occurrences WHERE owner='event' AND record_id=?", args: [completed.workflow!.id] });
    const activityId = String(occurrence.rows[0]!.activity_id);
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('kept-preview','owner',?,'{}',1)", args: [activityId] });
    await db.execute({ sql: "INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at) VALUES ('kept','owner',?,'budget','kept-preview','kept','completed',?,2)", args: [activityId, JSON.stringify({ resolution: 'kept_actual', ...(keptEntry ? { entry: keptEntry } : {}) })] });
    const plan = await resolveManagedFinancialPlan('owner', 'receipt', { dbClient: db });
    expect(plan?.workflow).toMatchObject({ correction: { state: 'completed', resolution: 'kept_actual' }, completion: { canComplete: false } });
    expect(plan?.reconciliation.reason).toContain('kept');
    if (keptEntry) expect(plan).toMatchObject({ candidate: { type: 'income', amount: 37, due_date: DATE, payee: 'Observed merchant' }, targets: { account: { id: 'checking' } } });
    else {
      expect(plan?.candidate).toEqual({});
      expect(plan?.operation).toMatchObject({ kind: 'no_write', intended: null });
      expect(Object.values(plan!.targets).every(target => target.id === null)).toBe(true);
      expect((await store.getDocumentForEmail('owner', 'receipt'))?.ownerConfirmedEntry).toBeNull();
    }
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

async function addFinancialCorrectionSchema(db: Client): Promise<void> {
  for (const file of ['030_owner_bootstrap.sql', '041_email_transaction_imports.sql', '042_transaction_import_item_subject.sql',
    '053_transaction_import_financial_plans.sql', '055_generic_financial_email_imports.sql',
    '056_generic_financial_email_automation.sql', '058_generic_financial_email_income_automation.sql',
    '059_generic_financial_email_transfer_automation.sql', '063_financial_activity.sql', '064_financial_corrections.sql']) {
    await db.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
  }
}
