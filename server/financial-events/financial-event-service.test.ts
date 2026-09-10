import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { ActualPayee } from "../../shared/types/actual.ts";
import type { EmailAuthenticationProjection } from "../../shared/types/email.ts";
import type { ActualFinancialOperationInput, ActualFinancialOperationResult } from "../../shared/types/financial-operations.ts";
import type { ActualTransferScheduleInput } from "../../shared/types/transaction-imports.ts";
import { createBillCandidateVerificationService } from "../bills/bill-candidate-verification-service.ts";
import { readFinancialProfiles } from "../bills/financial-profiles.ts";
import { createFinancialEmailPlanner } from "../bills/financial-email-planner.ts";
import { createFinancialEventExecutor } from "./financial-event-operation.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";
import { createFinancialEventWorker } from "./financial-event-service.ts";

import { day, arrival, receipt, authentication, type Source, saveReceiptProfile, accounts, type LedgerEntry, initializeFinancialEventTestSchema } from "./financial-event-service.test-utils.ts";
describe("autonomous financial event processing", () => {
  let db: Client;
  let clock: number;
  let store: ReturnType<typeof createFinancialEventStore>;
  let worker: ReturnType<typeof createFinancialEventWorker>;
  let sources: Map<string, Source>;
  let assessments: Map<string, Array<BillCandidate | null>>;
  let ledger: LedgerEntry[];
  let payees: ActualPayee[];
  let schedules: Array<{ id: string; input: ActualFinancialOperationInput | ActualTransferScheduleInput }>;
  let admitted: Map<string, string>;
  let activeBudget: string;
  let providerCredits: number;
  let providerReply: BillCandidate | null;
  let providerOffline: boolean;
  let matchingOffline: boolean;
  let assessmentCredits: number;
  let assessmentOffline: boolean;
  let aiEnabled: boolean;
  let currentAccounts: typeof accounts;
  let loseWriteResponse: boolean;
  let duringPreview: (() => Promise<void>) | null;
  let existingActualPreview: ActualFinancialOperationResult | null;

  function actualResult(input: ActualFinancialOperationInput, outcome: ActualFinancialOperationResult["outcome"]): ActualFinancialOperationResult {
    return { outcome, reason: outcome, budgetId: input.budgetId || activeBudget,
      ...(ledger.find((entry) => entry.identityKey === input.identityKey)
        ? { transactionId: ledger.find((entry) => entry.identityKey === input.identityKey)!.id } : {}),
      ...(schedules.find((schedule) => schedule.input.identityKey === input.identityKey)
        ? { scheduleId: schedules.find((schedule) => schedule.input.identityKey === input.identityKey)!.id } : {}) };
  }

  function newWorker() {
    const verification = createBillCandidateVerificationService({
      credentialResolver: async () => null,
      providers: { openai: { extract: async (request) => {
        providerCredits--;
        if (providerOffline || (matchingOffline && request.usagePurpose === "matching")) throw new Error("Provider unavailable");
        return { fields: structuredClone(providerReply || {}), usage: {} };
      } } },
    });
    const planner = createFinancialEmailPlanner({
      candidateVerification: verification,
      profileReader: userId => readFinancialProfiles(userId, { dbClient: db }),
      modelChoiceReader: async () => ({ provider: "openai", model: "fixture" }),
      metadataReader: async () => ({ accounts: currentAccounts, payees, payeeMap: Object.fromEntries(payees.map((payee) => [payee.id, payee.name])),
        categories: [], schedules: [], recentTransactions: [], syncHealth: { state: "current", lastSuccessAt: new Date(clock).toISOString() } }),
      occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current", lastSuccessAt: new Date(clock).toISOString() } }),
      transactionReader: async () => ({ transactions: ledger.map((entry) => ({
        id: entry.id, importedId: entry.identityKey, date: entry.date, amount: Math.abs(entry.amountCents) / 100,
        direction: entry.amountCents < 0 ? "expense" : "income", accountId: entry.accountId,
        account: accounts.find((account) => account.id === entry.accountId)!.name, payee: entry.payee,
        payeeId: entry.payeeId, transferAccountId: entry.transferAccountId, category: "", notes: "",
      })) }),
      now: () => new Date(clock),
    });
    const execute = createFinancialEventExecutor({
      financial: async (_userId, input, mode) => {
        if (mode === "preview") {
          const pending = duringPreview;
          duringPreview = null;
          await pending?.();
          if (existingActualPreview) return structuredClone(existingActualPreview);
          return actualResult(input, admitted.has(input.identityKey) ? "already_present" : "would_add");
        }
        if (mode === "recover") {
          return actualResult(input, admitted.get(input.identityKey) === JSON.stringify(input) ? "already_present" : "needs_review");
        }
        if (!input.budgetId || admitted.has(input.identityKey)) throw new Error("Actual rejected a repeated or unbound dispatch");
        admitted.set(input.identityKey, JSON.stringify(input));
        const base = { identityKey: input.identityKey, budgetId: input.budgetId, date: input.date };
        if (input.kind === "completed_transfer") {
          ledger.push({ ...base, id: "debit-" + ledger.length, accountId: input.fromAccountId,
            amountCents: -input.amountCents, transferAccountId: input.toAccountId, payee: "Transfer", payeeId: null });
          ledger.push({ ...base, id: "credit-" + ledger.length, accountId: input.toAccountId,
            amountCents: input.amountCents, transferAccountId: input.fromAccountId, payee: "Transfer", payeeId: null });
        } else if (input.kind === "utility_schedule") {
          schedules.push({ id: "utility-" + schedules.length, input: structuredClone(input) });
        } else {
          let payee = payees.find((item) => item.id === input.payeeId || item.name === input.payee);
          if (!payee) { payee = { id: "payee-" + payees.length, name: input.payee }; payees.push(payee); }
          ledger.push({ ...base, id: "entry-" + ledger.length, accountId: input.accountId,
            amountCents: input.amountCents, payee: payee.name, payeeId: payee.id });
        }
        if (loseWriteResponse) { loseWriteResponse = false; throw new Error("Actual response was lost after accepting write"); }
        return actualResult(input, "added");
      },
      transfer: async (_userId, input, mode) => {
        const existing = schedules.find((schedule) => schedule.input.identityKey === input.identityKey);
        if (mode === "preview") return { outcome: "would_create", reason: "Scheduled payment preview", budgetId: activeBudget };
        if (mode === "recover") return { outcome: existing && admitted.get(input.identityKey) === JSON.stringify(input)
          ? "already_scheduled" : "needs_review", reason: "Recovered schedule", budgetId: input.budgetId || activeBudget,
          ...(existing ? { scheduleId: existing.id } : {}) };
        if (!input.budgetId || existing) throw new Error("Actual rejected a repeated or unbound schedule");
        admitted.set(input.identityKey, JSON.stringify(input));
        const scheduleId = "payment-" + schedules.length;
        schedules.push({ id: scheduleId, input: structuredClone(input) });
        return { outcome: "created", reason: "Scheduled payment", budgetId: input.budgetId, scheduleId };
      },
    });
    return createFinancialEventWorker({ store, planner, execute, now: () => clock,
      profileReader: userId => readFinancialProfiles(userId, { dbClient: db }),
      sourceAcquirer: async (_userId, uid) => {
        const source = sources.get(uid)!;
        return { body: source.body, fromName: "Sender", fromAddress: source.from, subject: "Receipt or payment notice",
          emailDate: new Date(arrival + (source.receivedOffset || 0)).toISOString(), threadId: null, messageId: null,
          attachments: [], senderAuthentication: authentication(source) as EmailAuthenticationProjection };
      },
      assessDocument: async (_userId, email) => {
        assessmentCredits--;
        if (assessmentOffline) throw new Error("Assessment returned invalid output");
        const queued = assessments.get(email.email_id);
        return structuredClone(queued?.length ? queued.shift()! : sources.get(email.email_id)!.candidate);
      },
      canRun: async () => aiEnabled,
      afterWrite: async () => {},
    });
  }

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    await initializeFinancialEventTestSchema(db);
    await saveReceiptProfile(db);
    await db.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at = ?", args: [new Date(arrival - 60_000).toISOString()] });
    clock = arrival;
    store = createFinancialEventStore(db, () => clock);
    sources = new Map(); assessments = new Map(); ledger = []; payees = [{ id: "payee-0", name: "Example Merchant Inc." }]; schedules = []; admitted = new Map();
    activeBudget = "budget-1"; loseWriteResponse = false; duringPreview = null; existingActualPreview = null;
    providerCredits = 10; providerReply = null; providerOffline = false;
    matchingOffline = false; assessmentCredits = 10; assessmentOffline = false; aiEnabled = true; currentAccounts = [...accounts];
    worker = newWorker();
  });
  afterEach(() => db.close());

  async function arrive(source: Source) {
    sources.set(source.uid, source);
    const date = new Date(arrival + (source.receivedOffset || 0)).toISOString();
    await db.execute({
      sql: "INSERT INTO ea_email_index (uid,user_id,account_id,account_label,account_email,from_name,from_address,subject,body_text,email_date,email_date_utc,indexed_at,sender_authentication_json,read) VALUES (?,'owner','gmail','Mail','owner@example.test','Sender',?,'Receipt or payment notice',?,?,?,?,?,1)",
      args: [source.uid, source.from, source.body, date, date, date, JSON.stringify(authentication(source))],
    });
  }

  async function revise(source: Source) {
    sources.set(source.uid, source);
    await db.execute({ sql: "UPDATE ea_email_index SET body_text = ?, sender_authentication_json = ? WHERE uid = ?",
      args: [source.body, JSON.stringify(authentication(source)), source.uid] });
  }

  async function assessArrivals() {
    for (let i = 0; i < 20; i++) if (!await worker.processNextDocument()) return;
    throw new Error("Document processing did not become idle");
  }

  async function processEvents() {
    for (let i = 0; i < 20; i++) if (!await worker.processNextEvent()) return;
    throw new Error("Event processing did not become idle");
  }

  it("records an exact profile-backed receipt without waiting for unrelated capture or assessment", async () => {
    await arrive(receipt("ready"));
    await assessArrivals();
    await db.execute({ sql: `INSERT INTO ea_financial_intake_state (user_id, account_id, completed_through, status, updated_at)
      VALUES ('owner', 'gmail', ?, 'retry', ?)`, args: [new Date(clock - 86400_000).toISOString(), clock] });
    await arrive(receipt("unrelated", { reference: "different-order", value: 50 }));
    const unrelated = await store.claimDocument("slow-provider");
    expect(unrelated?.emailUid).toBe("unrelated");
    expect(await store.getEventForEmail("owner", "ready")).toMatchObject({ nextAttemptAt: clock });
    worker = newWorker();
    expect(await worker.processNextEvent()).toBe(true);
    expect(ledger.map(entry => entry.amountCents)).toEqual([-3000]);
    expect(await store.getEventForEmail("owner", "ready")).toMatchObject({ status: "settled" });
  });

  it("plans an unmapped receipt immediately despite unrelated capture and assessment outages", async () => {
    await saveReceiptProfile(db, false);
    await arrive(receipt("unidentified", { reference: "" }));
    await assessArrivals();
    await db.execute({ sql: `INSERT INTO ea_financial_intake_state (user_id, account_id, completed_through, status, updated_at)
      VALUES ('owner', 'gmail', ?, 'retry', ?)`, args: [new Date(clock - 86400_000).toISOString(), clock] });
    await arrive(receipt("unrelated", { reference: "different-order", value: 50 }));
    await store.claimDocument("slow-provider");
    expect(await store.getEventForEmail("owner", "unidentified")).toMatchObject({ nextAttemptAt: clock });
    expect(await worker.processNextEvent()).toBe(true);
    expect(await store.getEventForEmail("owner", "unidentified")).toMatchObject({ status: "needs_review", nextAttemptAt: null,
      plan: { candidate: { amount: 30, payee: "Example Merchant Inc.", due_date: day } } });
    expect(await worker.processNextEvent()).toBe(false);
    expect(ledger).toEqual([]);
  });

  it.each(["already_present", "would_add", "needs_review"] as const)("checks Actual before unmapped review and handles %s without admitting a write", async outcome => {
    await saveReceiptProfile(db, false);
    existingActualPreview = { outcome, reason: outcome, budgetId: "budget-1",
      ...(outcome === "already_present" ? { transactionId: "earlier-entry" } : {}) };
    await arrive(receipt("later-email"));
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", "later-email")).toMatchObject({
      status: outcome === "already_present" ? "settled" : "needs_review", operation: null, attemptedAt: null, nextAttemptAt: null,
      plan: { profile: { status: "missing" }, ...(outcome === "already_present"
        ? { reconciliation: { status: "already_recorded", evidence: { transactionId: "earlier-entry" } } } : {}) },
      ...(outcome === "already_present" ? { outcome: { outcome, transactionId: "earlier-entry" } } : {}),
    });
    expect(ledger).toEqual([]);
    expect(schedules).toEqual([]);
  });

  it("does not resolve an incomplete receipt from an unrelated existing Actual result", async () => {
    await saveReceiptProfile(db, false);
    existingActualPreview = { outcome: "already_present", reason: "Earlier entry", budgetId: "budget-1", transactionId: "earlier-entry" };
    const source = receipt("missing-amount");
    await arrive({ ...source, candidate: { ...source.candidate, amount: null, amount_candidates: [] } });
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ status: "needs_review", outcome: null, operation: null });
    expect(ledger).toEqual([]);
  });

  it("bounds failed document assessments across restarts without charging paused checks, and admits changed evidence", async () => {
    await arrive(receipt("assessment-outage"));
    aiEnabled = false;
    for (let tick = 0; tick < 4; tick++) {
      await assessArrivals();
      clock += 2 * 60 * 60_000;
    }
    expect(assessmentCredits).toBe(10);
    aiEnabled = true; assessmentOffline = true;
    for (let tick = 0; tick < 5; tick++) {
      worker = newWorker();
      await assessArrivals();
      clock += 2 * 60 * 60_000;
    }
    expect(assessmentCredits).toBe(7);
    expect(await store.getEventForEmail("owner", "assessment-outage")).toBeNull();
    assessmentOffline = false;
    await revise(receipt("assessment-outage", { value: 40 }));
    await assessArrivals();
    await processEvents();
    expect(assessmentCredits).toBe(6);
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-4000]);
  });

  it("retains inferred suggestions for review across restarts, then uses a newly saved profile", async () => {
    await saveReceiptProfile(db, false);
    const source = receipt("new-account");
    providerReply = source.candidate;
    matchingOffline = true;
    currentAccounts = accounts.filter((account) => account.id !== "card");
    await arrive({ ...source, candidate: { ...source.candidate, due_date: null } });
    await assessArrivals();
    await processEvents();
    const creditsAfterAssessment = providerCredits;
    for (let tick = 0; tick < 5; tick++) {
      clock += 16 * 60_000;
      worker = newWorker();
      await worker.processNextEvent();
    }
    expect(providerCredits).toBe(creditsAfterAssessment);
    expect(ledger).toEqual([]);
    currentAccounts = [...accounts];
    await saveReceiptProfile(db);
    clock += 16 * 60_000;
    await worker.processNextEvent();
    expect(providerCredits).toBe(creditsAfterAssessment);
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-3000]);
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ status: "settled", revision: 1 });
  });

  it("stops paid planning for unchanged blocked evidence across deadlines and worker restarts", async () => {
    const source = receipt("missing-date", { funding: false });
    source.body = source.body.replace(" on " + day, "");
    source.candidate = { ...source.candidate, due_date: null, event_evidence: "Paid $30.00" };
    providerReply = source.candidate;
    await arrive(source);
    await assessArrivals();
    await processEvents();
    const remainingCredits = providerCredits;
    const remainingAssessmentCredits = assessmentCredits;
    for (let retry = 0; retry < 4; retry++) {
      clock += 16 * 60_000;
      worker = newWorker();
      await worker.processNextEvent();
    }
    // The external provider's remaining billing credit is the costly regression.
    expect(providerCredits).toBe(remainingCredits);
    expect(assessmentCredits).toBe(remainingAssessmentCredits);
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({
      status: "needs_review", nextAttemptAt: null, revision: 1, attempts: 1, operation: null,
      plan: { workflow: { state: "needs_review", nextAttemptAt: null } },
    });
    expect(ledger).toEqual([]);
    await revise(receipt(source.uid));
    await assessArrivals();
    await processEvents();
    expect((await store.getEventForEmail("owner", source.uid))?.status).toBe("settled");
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-3000]);
  });

  it.each([true, false])("bounds unavailable AI retries while allowing recovery: %s", async (recovers) => {
    const source = receipt("provider-outage");
    providerReply = source.candidate;
    providerOffline = true;
    await arrive({ ...source, candidate: { ...source.candidate, due_date: null } });
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ status: "waiting", attempts: 1 });
    providerOffline = !recovers;
    for (let retry = 0; retry < 4; retry++) {
      clock += 16 * 60_000;
      worker = newWorker();
      await worker.processNextEvent();
    }
    expect(providerCredits).toBe(recovers ? 8 : 7);
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({
      status: recovers ? "settled" : "waiting", attempts: recovers ? 1 : 5,
    });
    expect(ledger.map((entry) => entry.amountCents)).toEqual(recovers ? [-3000] : []);
  });

  it("records an initial undated purchase using the original email day and preserves its source across recovery", async () => {
    const source = receipt("initial-order", { role: "merchant_receipt", receivedOffset: 6 * 3600_000 + 10 * 60_000 });
    source.body = source.body.replace("Paid $30.00 on " + day, "Your order is confirmed for $30.00");
    source.candidate = { ...source.candidate, due_date: null, type_confidence: 0.99, type_evidence: "Your order is confirmed",
      event_evidence: "Your order is confirmed", amount_candidates: [{ kind: "transaction_amount", value: 30, confidence: 0.99, evidence: "$30.00" }],
      purchase_date_context: { kind: "initial_confirmation_without_date", confidence: 0.99, evidence: "Your order is confirmed" } };
    clock = arrival + 2 * 86400_000;
    await arrive(source); await assessArrivals(); await processEvents();
    expect(ledger.map(entry => [entry.date, entry.amountCents])).toEqual([[day, -3000]]);
    const event = await store.getEventForEmail("owner", source.uid);
    expect(event).toMatchObject({ status: "settled", plan: { candidate: { due_date: day, operation_date_source: {
      kind: "email_date", emailUid: source.uid, emailDate: "2026-09-07T00:30:00.000Z", timeZone: "America/Los_Angeles", date: day,
    } } } });
    worker = newWorker(); await worker.recoverStaleClaims(); await processEvents();
    expect(ledger).toHaveLength(1);
  });

  it("combines complementary merchant and processor receipts into one signed entry using the saved payee", async () => {
    await arrive(receipt("merchant", { role: "merchant_receipt", funding: false }));
    await arrive(receipt("processor", { receivedOffset: 13_000 }));
    await assessArrivals();
    await processEvents();

    const event = await store.getEventForEmail("owner", "merchant");
    expect(event).toMatchObject({ status: "settled", outcome: { outcome: "added" }, documents: [{ emailUid: "merchant" }, { emailUid: "processor" }],
      operation: { executor: "financial", input: { kind: "transaction", accountId: "card", amountCents: -3000, budgetId: "budget-1" } } });
    expect((await store.getEventForEmail("owner", "processor"))?.id).toBe(event!.id);
    expect(ledger).toEqual([{ id: "entry-0", identityKey: "financial-event:" + event!.id, budgetId: "budget-1",
      accountId: "card", amountCents: -3000, date: day, payee: "Example Merchant Inc.", payeeId: "payee-0" }]);
    expect(payees).toEqual([{ id: "payee-0", name: "Example Merchant Inc." }]);
    expect(schedules).toEqual([]);
  });

  it("keeps distinct same-day same-value merchant receipts as separate purchases", async () => {
    await arrive(receipt("order-a", { role: "merchant_receipt" }));
    await arrive(receipt("order-b", { role: "merchant_receipt", receivedOffset: 30_000 }));
    await assessArrivals();
    await processEvents();

    const first = await store.getEventForEmail("owner", "order-a");
    const second = await store.getEventForEmail("owner", "order-b");
    expect(first?.status).toBe("settled");
    expect(second?.status).toBe("settled");
    expect(first!.id).not.toBe(second!.id);
    expect(ledger.map((entry) => [entry.accountId, entry.amountCents])).toEqual([["card", -3000], ["card", -3000]]);
  });

  it("uses persisted reference identity across worker restarts and repeat delivery", async () => {
    await arrive(receipt("original", { reference: "processor-purchase-reference" }));
    await assessArrivals();
    await processEvents();
    const original = await store.getEventForEmail("owner", "original");
    worker = newWorker();
    await arrive(receipt("copy", { reference: "processor-purchase-reference", receivedOffset: 31 * 86_400_000 }));
    await assessArrivals();
    await processEvents();

    expect(await store.getEventForEmail("owner", "copy")).toMatchObject({ id: original!.id, status: "settled",
      operation: original!.operation, outcome: original!.outcome });
    expect(ledger).toHaveLength(1);
    expect((await store.getDocumentForEmail("owner", "copy"))?.status).toBe("associated");
  });

  it.each(["contradiction", "failed amount audit", "missing date", "unsupported year"])("surfaces %s immediately and reconsiders only after source enrichment", async (failure) => {
    const source = receipt("reassessment");
    const initial: BillCandidate = { ...source.candidate,
      ...(failure === "contradiction" ? { event_kind: "refund" } : {}),
      ...(failure === "failed amount audit" ? { amount_verification: {
        status: "failed", source_value_count: 2, initial_covered_count: 1,
      } } : {}),
      ...(failure === "missing date" ? { due_date: null } : {}),
      ...(failure === "unsupported year" ? { due_date: "2024-09-06" } : {}),
    };
    assessments.set(source.uid, [initial, source.candidate]);
    await arrive(source);
    await assessArrivals();
    const document = await store.getDocumentForEmail("owner", source.uid);
    expect(document).toMatchObject({ status: "associated", candidate: initial, nextAttemptAt: null });
    await processEvents();
    const review = await store.getEventForEmail("owner", source.uid);
    expect(review).toMatchObject({ status: "needs_review", nextAttemptAt: null, operation: null });
    expect(ledger).toEqual([]);
    const remainingAssessmentCredits = assessmentCredits;
    const remainingProviderCredits = providerCredits;
    clock += 24 * 3600_000;
    worker = newWorker();
    expect(await worker.processNextDocument()).toBe(false);
    expect(await worker.processNextEvent()).toBe(false);
    expect(assessmentCredits).toBe(remainingAssessmentCredits);
    expect(providerCredits).toBe(remainingProviderCredits);

    await revise({ ...source, body: source.body + " Corrected purchase confirmation." });
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ id: review!.id, status: "settled", plan: { candidate: { type: "expense", event_kind: "purchase" } } });
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-3000]);
  });

  it("keeps competing purchase amounts unwritten until the source identifies the current amount", async () => {
    const source = receipt("ambiguous-total");
    await arrive({ ...source, body: source.body + " Another payment $45.00.", candidate: {
      ...source.candidate, amount: null, amount_kind: null,
      amount_candidates: [
        { kind: "transaction_amount", value: 30, confidence: 0.99, evidence: "Paid $30.00" },
        { kind: "transaction_amount", value: 45, confidence: 0.99, evidence: "Another payment $45.00" },
      ],
    } });
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ status: "needs_review", nextAttemptAt: null, operation: null });
    expect(ledger).toEqual([]);

    await revise(receipt(source.uid, { value: 45 }));
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ status: "settled", operation: { input: { amountCents: -4500 } } });
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-4500]);
  });

  it("processes a read and dismissed arrival with no inbox triage row", async () => {
    await arrive(receipt("dismissed"));
    await db.execute("INSERT INTO ea_dismissed_emails (user_id,email_id) VALUES ('owner','dismissed')");
    await assessArrivals();
    await processEvents();
    expect((await db.execute("SELECT email_id FROM ea_email_triage")).rows).toEqual([]);
    expect(await store.getEventForEmail("owner", "dismissed")).toMatchObject({ status: "settled" });
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-3000]);
  });

  it("ignores completed account transfers without creating a transfer", async () => {
    const source = receipt("account-transfer-completed");
    await arrive({ ...source, candidate: { ...source.candidate, type: "transfer", event_kind: "account_transfer_completed" } });
    await assessArrivals(); await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toBeNull();
    expect(await store.getDocumentForEmail("owner", source.uid)).toMatchObject({ status: "ignored" });
    expect(ledger).toEqual([]);
    expect(schedules).toEqual([]);
  });

  it.each(["date", "authentication"])("waits for missing %s and automatically processes corrected source evidence", async (missing) => {
    const source = receipt("incomplete");
    const incomplete = missing === "date" ? { ...source, body: source.body.replace(" on " + day, ""),
      candidate: { ...source.candidate, due_date: null, event_evidence: "Paid $30.00" } } : { ...source, authenticated: false };
    await arrive(incomplete);
    await assessArrivals();
    await processEvents();
    const waiting = await store.getEventForEmail("owner", source.uid);
    if (missing === "date") {
      expect(waiting).toMatchObject({ status: "needs_review", nextAttemptAt: null, operation: null });
    } else {
      const document = await store.getDocumentForEmail("owner", source.uid);
      expect(waiting).toBeNull();
      expect(document).toMatchObject({ status: "retry", eventId: null, candidate: source.candidate });
      expect(document!.nextAttemptAt).toBeGreaterThan(clock);
    }
    expect(ledger).toEqual([]);

    await revise(source);
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({
      ...(waiting ? { id: waiting.id } : {}), status: "settled",
    });
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-3000]);
  });

  it("records a mapped merchant receipt and joins a supporting receipt once its authentication is verified", async () => {
    await arrive(receipt("merchant", { role: "merchant_receipt", funding: false }));
    await arrive(receipt("support", { authenticated: false, receivedOffset: 13_000 }));
    await assessArrivals();
    await processEvents();
    expect(ledger).toHaveLength(1);

    await revise(receipt("support", { authenticated: true, receivedOffset: 13_000 }));
    await assessArrivals();
    await processEvents();
    const merchant = await store.getEventForEmail("owner", "merchant");
    const support = await store.getEventForEmail("owner", "support");
    expect(merchant).toMatchObject({ status: "settled", documents: [{ emailUid: "merchant" }, { emailUid: "support" }] });
    expect(support!.id).toBe(merchant!.id);
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-3000]);
  });

  it("cannot claim a new reference through an unauthenticated revision of an existing event", async () => {
    await arrive(receipt("original", { reference: "original-reference" }));
    await assessArrivals();
    await processEvents();
    const original = await store.getEventForEmail("owner", "original");

    await revise(receipt("original", { reference: "independent-reference", authenticated: false }));
    await assessArrivals();
    await arrive(receipt("independent", { reference: "independent-reference" }));
    await assessArrivals();
    await processEvents();
    const independent = await store.getEventForEmail("owner", "independent");
    expect(independent).toMatchObject({ status: "settled", outcome: { outcome: "added" } });
    expect(independent!.id).not.toBe(original!.id);
    expect((await store.getEventForEmail("owner", "original"))?.status).toBe("needs_review");
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-3000, -3000]);
  });

  it.each([false, true])("recovers an uncertain write with its original bound payload, changed source: %s", async (sourceChanged) => {
    await arrive(receipt("uncertain"));
    loseWriteResponse = true;
    await assessArrivals();
    await processEvents();
    const interrupted = await store.getEventForEmail("owner", "uncertain");
    expect(interrupted).toMatchObject({ status: "waiting", operation: { input: { amountCents: -3000, budgetId: "budget-1" } } });
    expect(interrupted!.attemptedAt).not.toBeNull();
    expect(ledger).toHaveLength(1);

    activeBudget = "budget-2";
    if (sourceChanged) await revise(receipt("uncertain", { value: 45 }));
    else clock = interrupted!.nextAttemptAt!;
    worker = newWorker();
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", "uncertain")).toMatchObject({
      status: sourceChanged ? "needs_review" : "settled", operation: interrupted!.operation,
      outcome: { outcome: "already_present", budgetId: "budget-1" } });
    expect(ledger.map((entry) => [entry.amountCents, entry.budgetId])).toEqual([[-3000, "budget-1"]]);
  });

  it.each(["payment failure", "merchant correction"])("preserves the recorded entry and exposes a later %s", async (change) => {
    const source = receipt("changed-purpose");
    await arrive(source);
    await assessArrivals();
    await processEvents();
    const recorded = await store.getEventForEmail("owner", source.uid);
    const changed: Source = change === "payment failure" ? {
      ...source, body: source.body + " The payment failed.", candidate: {
        ...source.candidate, event_kind: "payment_failed", event_evidence: "The payment failed.",
      },
    } : {
      ...source, body: source.body.replaceAll("Example Merchant Inc.", "Corrected Merchant Inc."), candidate: {
        ...source.candidate, payee: "Corrected Merchant Inc.", payee_hint: "Corrected Merchant Inc.",
      },
    };
    await revise(changed);
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({
      id: recorded!.id, status: "needs_review", operation: recorded!.operation, outcome: { outcome: "already_present" },
    });
    expect(ledger.map((entry) => [entry.amountCents, entry.payee])).toEqual([[-3000, "Example Merchant Inc."]]);
  });

  it("cannot dispatch a preview when a new source revision arrives before admission", async () => {
    await arrive(receipt("changing"));
    await assessArrivals();
    duringPreview = () => revise(receipt("changing", { value: 45 }));
    await processEvents();
    expect((await store.getEventForEmail("owner", "changing"))?.operation).toBeNull();
    expect(ledger).toEqual([]);

    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", "changing")).toMatchObject({ status: "settled", operation: { input: { amountCents: -4500 } } });
    expect(ledger.map((entry) => entry.amountCents)).toEqual([-4500]);
  });
});
