import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { ActualPayee } from "../../shared/types/actual.ts";
import type { ActualFinancialOperationInput, ActualFinancialOperationResult } from "../../shared/types/financial-operations.ts";
import type { ActualTransferScheduleInput } from "../../shared/types/transaction-imports.ts";
import { createBillCandidateVerificationService } from "../bills/bill-candidate-verification-service.ts";
import { createFinancialEmailPlanner } from "../bills/financial-email-planner.ts";
import { createFinancialEventExecutor } from "./financial-event-operation.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";
import { createFinancialEventWorker } from "./financial-event-service.ts";

const day = "2026-09-06";
const arrival = Date.parse(day + "T18:20:00Z");
const accounts = [
  { id: "card", name: "Example Rewards Mastercard (3234)", type: "credit" },
  { id: "checking", name: "Everyday Checking (0001)", type: "checking" },
  { id: "savings", name: "Rainy Day Savings (0002)", type: "savings" },
];

interface Source {
  uid: string;
  from: string;
  body: string;
  candidate: BillCandidate | null;
  receivedOffset?: number;
  authenticated?: boolean;
}

interface LedgerEntry {
  id: string;
  identityKey: string;
  budgetId: string;
  accountId: string;
  amountCents: number;
  date: string;
  payee: string;
  payeeId: string | null;
  transferAccountId?: string;
}

function receipt(uid: string, { role = "processor_receipt", funding = true, reference = uid,
  value = 30, receivedOffset = 0, authenticated = true }: {
  role?: BillCandidate["document_role"]; funding?: boolean; reference?: string; value?: number;
  receivedOffset?: number; authenticated?: boolean;
} = {}): Source {
  const paid = "Paid $" + value.toFixed(2) + " on " + day;
  const body = "Purchase from Example Merchant Inc. " + paid + ". Reference: " + reference + "."
    + (funding ? " Payment method: Example Rewards Mastercard." : "");
  return {
    uid, body, receivedOffset, authenticated,
    from: role === "merchant_receipt" ? "receipt@merchant.example" : "payment@processor.example",
    candidate: {
      type: "expense", type_confidence: 0.99, type_evidence: "Purchase from Example Merchant Inc.",
      event_kind: "purchase", event_confidence: 0.99, event_evidence: paid,
      document_role: role, payee: "Example Merchant Inc.", payee_hint: "Example Merchant Inc.",
      amount: value, amount_kind: "transaction_amount", currency: "USD", due_date: day,
      amount_candidates: [{ kind: "transaction_amount", value, confidence: 0.99, evidence: "Paid $" + value.toFixed(2) }],
      provider_reference: reference, provider_reference_evidence: "Reference: " + reference,
      provider_reference_confidence: 0.99,
      ...(funding ? { account_hint: "Example Rewards Mastercard", account_hint_confidence: 0.99 } : {}),
    },
  };
}

function authentication(source: Source) {
  const domain = source.from.split("@")[1];
  const pass = source.authenticated !== false;
  return {
    version: 1, provider: "gmail", source: "gmail_authentication_results", evaluatedAt: new Date(arrival).toISOString(),
    status: pass ? "pass" : "unavailable", headerFromDomain: pass ? domain : null,
    dkim: pass ? [{ result: "pass", domain, aligned: true }] : [],
    spf: pass ? { result: "pass", domain, aligned: true } : null,
    dmarc: pass ? { result: "pass", domain, aligned: true } : null,
  };
}

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
  let loseWriteResponse: boolean;
  let duringPreview: (() => Promise<void>) | null;

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
      providers: { openai: { extract: async () => ({ fields: {}, usage: {} }) } },
    });
    const planner = createFinancialEmailPlanner({
      candidateVerification: verification,
      modelChoiceReader: async () => ({ provider: "openai", model: "fixture" }),
      metadataReader: async () => ({ accounts, payees, payeeMap: Object.fromEntries(payees.map((payee) => [payee.id, payee.name])),
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
      assessDocument: async (_userId, email) => {
        const queued = assessments.get(email.email_id);
        return structuredClone(queued?.length ? queued.shift()! : sources.get(email.email_id)!.candidate);
      },
      canRun: async () => true,
      afterWrite: async () => {},
    });
  }

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql",
      "054_email_sender_authentication.sql", "062_financial_events.sql"]) {
      await db.executeMultiple(readFileSync(new URL("../db/migrations/" + file, import.meta.url), "utf8"));
    }
    await db.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at = ?", args: [new Date(arrival - 60_000).toISOString()] });
    clock = arrival;
    store = createFinancialEventStore(db, () => clock);
    sources = new Map(); assessments = new Map(); ledger = []; payees = []; schedules = []; admitted = new Map();
    activeBudget = "budget-1"; loseWriteResponse = false; duringPreview = null;
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
    clock += 90_000;
    for (let i = 0; i < 20; i++) if (!await worker.processNextEvent()) return;
    throw new Error("Event processing did not become idle");
  }

  it("combines complementary merchant and processor receipts into one signed entry and a new payee", async () => {
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
      operation: original!.operation, outcome: { outcome: "already_present" } });
    expect(ledger).toHaveLength(1);
    expect((await store.getDocumentForEmail("owner", "copy"))?.status).toBe("associated");
  });

  it.each(["contradiction", "failed amount audit", "missing date", "unsupported year"])("reassesses %s before assigning a purchase identity", async (failure) => {
    const source = receipt("reassessment");
    const initial: BillCandidate = { ...source.candidate,
      ...(failure === "contradiction" ? { event_kind: "card_payment_completed" } : {}),
      ...(failure === "failed amount audit" ? { amount_verification: {
        status: "failed", source_value_count: 2, initial_covered_count: 1,
      } } : {}),
      ...(failure === "missing date" ? { due_date: null } : {}),
      ...(failure === "unsupported year" ? { due_date: "2024-09-06" } : {}),
    };
    assessments.set(source.uid, [initial, source.candidate]);
    await arrive(source);
    await assessArrivals();
    const waiting = await store.getDocumentForEmail("owner", source.uid);
    expect(waiting).toMatchObject({ status: "retry", candidate: null, eventId: null });
    expect(waiting!.nextAttemptAt).toBeGreaterThan(clock);
    expect(ledger).toEqual([]);

    clock = waiting!.nextAttemptAt!;
    await assessArrivals();
    await processEvents();
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ status: "settled", plan: { candidate: { type: "expense", event_kind: "purchase" } } });
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
    expect(await store.getEventForEmail("owner", source.uid)).toMatchObject({ status: "waiting", operation: null });
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

  it.each(["card_payment_completed", "account_transfer_completed", "payment_scheduled", "bill_issued"] as const)(
    "records the correct transaction or schedule for %s", async (eventKind) => {
      const utility = eventKind === "bill_issued";
      const destination = eventKind === "account_transfer_completed" ? "Rainy Day Savings" : "Example Rewards Mastercard";
      const eventEvidence = (utility ? "Example Utility bill due" : eventKind === "payment_scheduled" ? "Payment scheduled" : "Payment completed")
        + " on " + day + ": $75.00 from Everyday Checking" + (utility ? "." : " to " + destination + ".");
      const amountKind = utility ? "total_due" : "payment_amount";
      await arrive({ uid: eventKind, from: "notices@bank.example", body: eventEvidence,
        candidate: {
          type: utility ? "bill" : "transfer", type_confidence: 0.99, type_evidence: eventEvidence,
          event_kind: eventKind, event_confidence: 0.99, event_evidence: eventEvidence,
          event_verification: { status: "kept_initial", provider: "openai", model: "fixture" },
          document_role: utility ? "statement" : "payment_notice", due_date: day, currency: "USD",
          amount: 75, amount_kind: amountKind, amount_candidates: [{ kind: amountKind, value: 75, evidence: "$75.00", confidence: 0.99 }],
          payee: utility ? "Example Utility" : destination, payee_hint: utility ? "Example Utility" : destination,
          ...(utility ? { account_hint: "Everyday Checking", account_hint_confidence: 0.99 }
            : { from_account_hint: "Everyday Checking", from_account_hint_confidence: 0.99,
              to_account_hint: destination, to_account_hint_confidence: 0.99 }),
        } });
      await assessArrivals();
      await processEvents();

      const event = await store.getEventForEmail("owner", eventKind);
      expect(event).toMatchObject({ status: "settled", outcome: { outcome: "added" } });
      if (utility || eventKind === "payment_scheduled") {
        expect(ledger).toEqual([]);
        expect(schedules).toHaveLength(1);
        expect(schedules[0]!.input).toMatchObject({ budgetId: "budget-1", date: day,
          ...(utility ? { kind: "utility_schedule", accountId: "checking", amountCents: -7500 }
            : { fromAccountId: "checking", toAccountId: "card", amountCents: 7500 }) });
      } else {
        const toAccountId = eventKind === "account_transfer_completed" ? "savings" : "card";
        expect(schedules).toEqual([]);
        expect(ledger.map((entry) => [entry.accountId, entry.amountCents, entry.transferAccountId]))
          .toEqual([["checking", -7500, toAccountId], [toAccountId, 7500, "checking"]]);
        expect(event!.operation).toMatchObject({ executor: "financial", input: { kind: "completed_transfer", budgetId: "budget-1" } });
      }
    });

  it.each(["date", "authentication"])("waits for missing %s and automatically processes corrected source evidence", async (missing) => {
    const source = receipt("incomplete");
    const incomplete = missing === "date" ? { ...source, body: source.body.replace(" on " + day, ""),
      candidate: { ...source.candidate, due_date: null, event_evidence: "Paid $30.00" } } : { ...source, authenticated: false };
    await arrive(incomplete);
    await assessArrivals();
    if (missing === "date") {
      // Exhaust bounded extraction retries; a source with no date then waits
      // for new evidence without repeatedly charging for the same assessment.
      for (let retry = 0; retry < 2; retry++) {
        clock = (await store.getDocumentForEmail("owner", source.uid))!.nextAttemptAt!;
        await assessArrivals();
      }
    }
    await processEvents();
    const waiting = await store.getEventForEmail("owner", source.uid);
    if (missing === "date") {
      expect(waiting).toMatchObject({ status: "waiting", operation: null });
      expect(waiting!.nextAttemptAt).toBeGreaterThan(clock);
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

  it("wakes a waiting merchant event when a supporting receipt gains verified authentication", async () => {
    await arrive(receipt("merchant", { role: "merchant_receipt", funding: false }));
    await arrive(receipt("support", { authenticated: false, receivedOffset: 13_000 }));
    await assessArrivals();
    await processEvents();
    expect(ledger).toEqual([]);

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
