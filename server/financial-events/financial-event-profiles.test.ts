import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { FinancialProfile } from "../../shared/types/financial-profiles.ts";
import type { ActualUtilityScheduleInput } from "../../shared/types/financial-operations.ts";
import type { ActualTransferScheduleInput } from "../../shared/types/transaction-imports.ts";
import { createBillCandidateVerificationService } from "../bills/bill-candidate-verification-service.ts";
import { createFinancialEmailPlanner } from "../bills/financial-email-planner.ts";
import { readFinancialProfiles } from "../bills/financial-profiles.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { createFinancialEventExecutor } from "./financial-event-operation.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";
import { createFinancialEventWorker } from "./financial-event-service.ts";
import { arrival, authentication, type Source } from "./financial-event-service.test-utils.ts";
import type { FinancialEmailSource } from "../email/financial-email-source.ts";
import type { EmailAuthenticationProjection } from "../../shared/types/email.ts";

const utilityProfile: FinancialProfile = {
  id: "electricity", name: "Electricity", enabled: true, budgetId: "budget",
  senderAddresses: ["billing@power.example"], target: { kind: "utility", scheduleId: "electric" },
};
const cardProfile: FinancialProfile = {
  id: "card", name: "Card payments", enabled: true, budgetId: "budget",
  senderAddresses: ["payments@card.example"],
  target: { kind: "card_payment", fromAccountId: "savings", toAccountId: "card", scheduleId: "card-payment" },
};
interface Schedule {
  id: string; name: string; type: "bill" | "transfer"; accountId: string; payeeId: string;
  amountCents: number; date: string; categoryId?: string; transferAccountId?: string;
}
type ScheduleInput = ActualUtilityScheduleInput | ActualTransferScheduleInput;

function notice(uid: string, date: string, amount: number, card = false): Source {
  const event = card ? "Your card payment is scheduled" : "Your new utility bill";
  const total = `Total $${amount.toFixed(2)}`;
  const body = `${event}. ${total} ${card ? "scheduled for" : "due"} ${date}. Reference: ${uid}.`;
  return {
    uid, body, from: card ? "payments@card.example" : "billing@power.example",
    candidate: {
      type: card ? "transfer" : "bill", type_confidence: 0.99, type_evidence: event,
      event_kind: card ? "payment_scheduled" : "bill_issued", event_confidence: 0.99, event_evidence: event,
      document_role: card ? "payment_notice" : "statement", currency: "USD", due_date: date,
      payee: card ? "Example Card" : "Power Company", payee_hint: card ? "Example Card" : "Power Company",
      amount, amount_kind: card ? "payment_amount" : "total_due",
      amount_candidates: [{ kind: card ? "payment_amount" : "total_due", value: amount, confidence: 0.99, evidence: total }],
      provider_reference: uid, provider_reference_confidence: 0.99, provider_reference_evidence: `Reference: ${uid}`,
      event_verification: { status: "kept_initial", provider: "openai", model: "fixture" },
    },
  };
}

describe("financial profile schedule lifecycle", () => {
  let db: Client;
  let clock: number;
  let store: ReturnType<typeof createFinancialEventStore>;
  let worker: ReturnType<typeof createFinancialEventWorker>;
  let sources: Map<string, Source>;
  let schedules: Schedule[];
  let savedUpdates: ScheduleInput[];
  let duringPreview: (() => Promise<void>) | null;
  let acquiredSources: Map<string, FinancialEmailSource>;
  let acquiredCandidates: Map<string, BillCandidate>;
  let sourceOffline: boolean;

  function metadata(): ActualMetadata {
    return {
      accounts: [{ id: "savings", name: "Savings", type: "savings" }, { id: "card", name: "Example Card", type: "credit" }],
      // Actual projects transfer identity onto schedules and omits transfer payees.
      payees: [{ id: "power", name: "Power Company" }],
      payeeMap: { power: "Power Company", "to-card": "Transfer: Example Card" },
      categories: [{ name: "Home", categories: [{ id: "electricity", name: "Electricity" }] }],
      schedules: schedules.map(schedule => ({
        id: schedule.id, name: schedule.name, type: schedule.type, next_date: schedule.date,
        transferAccountId: schedule.transferAccountId, posts_transaction: true,
        conditions: [
          { field: "account", op: "is", value: schedule.accountId },
          { field: "payee", op: "is", value: schedule.payeeId },
          { field: "amount", op: "is", value: schedule.amountCents },
          { field: "date", op: "is", value: { frequency: "monthly", start: schedule.date } },
          ...(schedule.categoryId ? [{ field: "category", op: "is", value: schedule.categoryId }] : []),
        ],
      })), recentTransactions: [],
    };
  }

  async function preview(input: ScheduleInput) {
    const schedule = schedules.find(entry => entry.id === input.scheduleId);
    if (!schedule) throw new Error("Actual requires an existing schedule");
    const fingerprint = JSON.stringify(schedule);
    const exact = schedule.date === input.date
      && schedule.amountCents === ("kind" in input ? input.amountCents : -input.amountCents);
    const update = duringPreview;
    duringPreview = null;
    await update?.();
    return { exact, reason: exact ? "Existing schedule matches" : "Existing schedule update", budgetId: "budget",
      scheduleId: schedule.id, scheduleFingerprint: fingerprint };
  }

  function write(input: ScheduleInput) {
    const schedule = schedules.find(entry => entry.id === input.scheduleId);
    if (!schedule || input.budgetId !== "budget" || input.expectedScheduleFingerprint !== JSON.stringify(schedule)) {
      throw new Error("Actual rejected a stale or unbound schedule update");
    }
    schedule.date = input.date;
    schedule.amountCents = "kind" in input ? input.amountCents : -input.amountCents;
    if ("categoryId" in input && input.categoryId) schedule.categoryId = input.categoryId;
    savedUpdates.push(structuredClone(input));
    return { outcome: "updated" as const, reason: "Existing schedule updated", budgetId: "budget", scheduleId: schedule.id };
  }

  function restart() {
    store = createFinancialEventStore(db, () => clock);
    const profileReader = (userId: string) => readFinancialProfiles(userId, { dbClient: db });
    const planner = createFinancialEmailPlanner({
      profileReader,
      metadataReader: async () => ({ ...metadata(), syncHealth: { state: "current", lastSuccessAt: new Date(clock).toISOString() } }),
      occurrenceReader: async () => ({ schedules: [] }), transactionReader: async () => ({ transactions: [] }),
      candidateVerification: createBillCandidateVerificationService({ credentialResolver: async () => null,
        providers: { openai: { extract: async () => { throw new Error("No additional email evidence is available"); } } } }),
      modelChoiceReader: async () => ({ provider: "openai", model: "fixture" }), now: () => new Date(clock),
    });
    const execute = createFinancialEventExecutor({
      financial: async (_userId, input, mode) => {
        if (input.kind !== "utility_schedule") throw new Error("This Actual fixture supports schedules only");
        if (mode === "preview") {
          const { exact, ...result } = await preview(input);
          return { ...result, outcome: exact ? "already_present" : "would_update" };
        }
        if (mode === "write_once") return write(input);
        const current = schedules.find(entry => entry.id === input.scheduleId);
        return { outcome: current?.date === input.date && current.amountCents === input.amountCents ? "already_present" : "needs_review",
          reason: "Current schedule verification", budgetId: "budget", scheduleId: input.scheduleId };
      },
      transfer: async (_userId, input, mode) => {
        if (mode === "preview") {
          const { exact, ...result } = await preview(input);
          return { ...result, outcome: exact ? "already_scheduled" : "would_update" };
        }
        if (mode === "create_once") return write(input);
        const current = schedules.find(entry => entry.id === input.scheduleId);
        return { outcome: current?.date === input.date && current.amountCents === -input.amountCents ? "already_scheduled" : "needs_review",
          reason: "Current payment verification", budgetId: "budget", scheduleId: input.scheduleId };
      },
    });
    worker = createFinancialEventWorker({ store, planner, execute, profileReader, now: () => clock,
      assessDocument: async (_userId, email) => structuredClone(
        email.body_text === acquiredSources.get(email.email_id)?.body && acquiredCandidates.has(email.email_id)
          ? acquiredCandidates.get(email.email_id)! : sources.get(email.email_id)!.candidate),
      sourceAcquirer: async (_userId, uid) => {
        if (sourceOffline) throw new Error("Provider is offline");
        return structuredClone(acquiredSources.get(uid)!);
      },
      canRun: async () => true, afterWrite: async () => {},
    });
  }

  async function saveProfiles(profiles: FinancialProfile[]) {
    await db.execute({ sql: "UPDATE ea_settings SET financial_profiles_json=?, financial_profiles_revision=financial_profiles_revision+1 WHERE user_id='owner'",
      args: [JSON.stringify(profiles)] });
  }

  async function arrive(source: Source) {
    sources.set(source.uid, source);
    const date = new Date(clock).toISOString();
    if (!acquiredSources.has(source.uid)) acquiredSources.set(source.uid, {
      body: source.body, fromName: "Provider", fromAddress: source.from, subject: "Bill or payment notice",
      emailDate: date, threadId: null, messageId: null, attachments: [],
      senderAuthentication: authentication(source) as EmailAuthenticationProjection,
    });
    await db.execute({
      sql: `INSERT INTO ea_email_index (uid,user_id,account_id,account_label,account_email,from_name,from_address,
        subject,body_text,email_date,email_date_utc,indexed_at,sender_authentication_json,read)
        VALUES (?,'owner','mail','Mail','owner@example.test','Provider',?,'Bill or payment notice',?,?,?,?,?,1)`,
      args: [source.uid, source.from, source.body, date, date, date, JSON.stringify(authentication(source))],
    });
    expect(await worker.processNextDocument()).toBe(true);
  }

  async function processEvent() {
    clock += 90_000;
    expect(await worker.processNextEvent()).toBe(true);
  }

  beforeEach(async () => {
    db = await createMigratedDb();
    clock = arrival;
    await db.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at=?", args: [new Date(clock - 60_000).toISOString()] });
    await db.execute("INSERT INTO ea_settings (user_id,actual_budget_sync_id) VALUES ('owner','budget')");
    sources = new Map(); acquiredSources = new Map(); acquiredCandidates = new Map(); sourceOffline = false;
    savedUpdates = []; duringPreview = null;
    schedules = [
      { id: "electric", name: "Electricity", type: "bill", accountId: "savings", payeeId: "power", categoryId: "electricity", amountCents: -5_000, date: "2026-08-21" },
      { id: "card-payment", name: "Card payment", type: "transfer", accountId: "savings", payeeId: "to-card", transferAccountId: "card", amountCents: -20_000, date: "2026-08-25" },
    ];
    restart();
  });
  afterEach(() => db.close());

  it("uses acquired PDF facts through restart and settlement with their source provenance", async () => {
    await saveProfiles([utilityProfile]);
    const complete = notice("pdf-invoice", "2026-09-21", 97.2);
    acquiredSources.set(complete.uid, { body: `Your new utility bill.\n[PDF attachment invoice.pdf, page 1]\n${complete.body}`,
      fromName: "Provider", fromAddress: complete.from, subject: "Bill or payment notice", emailDate: new Date(clock).toISOString(),
      threadId: null, messageId: null, senderAuthentication: authentication(complete) as EmailAuthenticationProjection,
      attachments: [{ partId: "2", filename: "invoice.pdf", sha256: "a".repeat(64), bytes: 1000, pages: 1, extractorVersion: "fixture-v1" }] });
    acquiredCandidates.set(complete.uid, complete.candidate!);
    await arrive({ ...complete, body: "Your new utility bill. See attached invoice.",
      candidate: { ...complete.candidate, amount: null, due_date: null, amount_candidates: [] } });
    sourceOffline = true;
    restart();
    await processEvent();
    const event = await store.getEventForEmail("owner", complete.uid);
    expect(event).toMatchObject({ status: "settled", outcome: { outcome: "updated", scheduleId: "electric" } });
    expect(event?.documents[0]?.acquiredSource?.attachments).toEqual(acquiredSources.get(complete.uid)!.attachments);
    expect(event?.documents[0]?.body).toBe(acquiredSources.get(complete.uid)!.body);
    expect(savedUpdates).toMatchObject([{ amountCents: -9720, date: "2026-09-21", categoryId: "electricity" }]);
    expect(await worker.processNextDocument()).toBe(false);
    expect(await worker.processNextEvent()).toBe(false);
  });

  it("uses freshly acquired sender authentication without promoting the old unavailable index verdict", async () => {
    await saveProfiles([utilityProfile]);
    const complete = notice("fresh-auth", "2026-09-21", 97.2);
    acquiredSources.set(complete.uid, { body: complete.body, fromName: "Provider", fromAddress: complete.from,
      subject: "Bill or payment notice", emailDate: new Date(clock).toISOString(), threadId: null, messageId: null,
      senderAuthentication: authentication(complete) as EmailAuthenticationProjection, attachments: [] });
    await arrive({ ...complete, authenticated: false });
    await processEvent();
    expect(await store.getEventForEmail("owner", complete.uid)).toMatchObject({ status: "settled",
      documents: [{ senderAuthentication: { status: "pass" }, acquiredSource: { senderAuthentication: { status: "pass" } } }] });
    const indexed = await db.execute({ sql: "SELECT sender_authentication_json FROM ea_email_index WHERE uid=?", args: [complete.uid] });
    expect(JSON.parse(String(indexed.rows[0]!.sender_authentication_json)).status).toBe("unavailable");
    expect(savedUpdates).toHaveLength(1);
  });

  it("checks the complete scheduled-payment source even when indexed sender authentication already passes", async () => {
    await saveProfiles([cardProfile]);
    const initial = notice("changed-payment-source", "2026-09-25", 251.32, true);
    const body = "Your card payment was cancelled.";
    acquiredSources.set(initial.uid, { body, fromName: "Provider", fromAddress: initial.from,
      subject: "Bill or payment notice", emailDate: new Date(clock).toISOString(), threadId: null, messageId: null,
      senderAuthentication: authentication(initial) as EmailAuthenticationProjection, attachments: [] });
    acquiredCandidates.set(initial.uid, { type: "transfer", type_confidence: 0.99, type_evidence: body,
      event_kind: "payment_cancelled", event_confidence: 0.99, event_evidence: body,
      amount: null, due_date: null, amount_candidates: [], document_role: "payment_notice" });
    await arrive(initial);
    await processEvent();
    expect(await store.getEventForEmail("owner", initial.uid)).toMatchObject({ status: "settled", attemptedAt: null,
      operation: null, plan: { operation: { intended: "no_write" } }, documents: [{ candidate: { event_kind: "payment_cancelled" } }] });
    expect(savedUpdates).toEqual([]);
  });

  it("updates two utility cycles and keeps late copies of the first cycle quiet after restart", async () => {
    await saveProfiles([utilityProfile]);
    await arrive(notice("september-original", "2026-09-21", 97.2));
    await processEvent();
    const first = await store.getEventForEmail("owner", "september-original");
    expect(first).toMatchObject({ status: "settled", outcome: { outcome: "updated", scheduleId: "electric" } });
    expect(savedUpdates).toMatchObject([{ kind: "utility_schedule", scheduleId: "electric", accountId: "savings",
      payeeId: "power", categoryId: "electricity", amountCents: -9_720, date: "2026-09-21" }]);

    clock += 31 * 86_400_000;
    await arrive(notice("october-original", "2026-10-23", 112.54));
    await processEvent();
    expect((await store.getEventForEmail("owner", "october-original"))?.id).not.toBe(first!.id);
    expect(savedUpdates).toHaveLength(2);
    expect(schedules[0]).toMatchObject({ id: "electric", amountCents: -11_254, date: "2026-10-23", categoryId: "electricity" });

    await saveProfiles([{ ...utilityProfile, id: "recreated-electric" },
      { ...utilityProfile, id: "alternate-electric", senderAddresses: ["statements@power.example"] }]);
    restart();
    for (const uid of ["september-copy", "september-reissued"]) {
      const repeated = notice(uid, "2026-09-21", 97.2);
      if (uid === "september-reissued") repeated.from = "statements@power.example";
      await arrive(repeated);
      await processEvent();
      expect(await store.getEventForEmail("owner", uid)).toMatchObject({ id: first!.id, status: "settled", operation: first!.operation });
    }
    expect(savedUpdates).toHaveLength(2);
    expect(schedules[0]).toMatchObject({ date: "2026-10-23", amountCents: -11_254 });
    expect(await worker.processNextEvent()).toBe(false);
    expect(await worker.getNextWakeAt()).toBeNull();
  });

  it("rejects first dispatch when the owner disables the matching profile during preview", async () => {
    await saveProfiles([utilityProfile]);
    await arrive(notice("profile-race", "2026-09-21", 97.2));
    duringPreview = () => saveProfiles([{ ...utilityProfile, enabled: false }]);
    await processEvent();
    expect(await store.getEventForEmail("owner", "profile-race")).toMatchObject({ operation: null, attemptedAt: null });
    expect(savedUpdates).toEqual([]);
    restart();
    expect(await worker.processNextEvent()).toBe(true);
    expect(await store.getEventForEmail("owner", "profile-race")).toMatchObject({ status: "needs_review", plan: { profile: { status: "missing" } } });
    expect(savedUpdates).toEqual([]);
    expect(await worker.processNextEvent()).toBe(false);
  });

  it("wakes and settles an arrival after its profile is saved", async () => {
    await arrive(notice("initially-unmapped", "2026-09-21", 97.2));
    await processEvent();
    const pending = await store.getEventForEmail("owner", "initially-unmapped");
    expect(pending).toMatchObject({ status: "needs_review", operation: null, plan: { profile: { status: "missing", revision: 0 } } });
    expect(await worker.processNextEvent()).toBe(false);
    await saveProfiles([utilityProfile]);
    restart();
    expect(await worker.processNextEvent()).toBe(true);
    const recorded = await store.getEventForEmail("owner", "initially-unmapped");
    expect(recorded).toMatchObject({ id: pending!.id, status: "settled",
      plan: { profile: { status: "matched", revision: 1 } }, outcome: { outcome: "updated" } });
    expect(savedUpdates).toHaveLength(1);
    expect(await worker.processNextEvent()).toBe(false);
  });

  it.each([false, true])("preserves an already-present Actual cycle without an attempt after later cycles and repeats (card: %s)", async card => {
    const profile = card ? cardProfile : utilityProfile;
    const schedule = schedules[card ? 1 : 0]!;
    const firstDate = card ? "2026-09-25" : "2026-09-21";
    const nextDate = card ? "2026-10-25" : "2026-10-23";
    schedule.date = firstDate;
    schedule.amountCents = -9_720;
    await saveProfiles([profile]);
    await arrive(notice("already-present", firstDate, 97.2, card));
    await processEvent();
    const existing = await store.getEventForEmail("owner", "already-present");
    expect(existing).toMatchObject({ status: "settled", operation: null, attemptedAt: null,
      outcome: { outcome: "already_present", scheduleId: schedule.id } });
    expect(savedUpdates).toEqual([]);

    clock += 31 * 86_400_000;
    await arrive(notice("following-cycle", nextDate, 112.54, card));
    await processEvent();
    expect((await store.getEventForEmail("owner", "following-cycle"))?.id).not.toBe(existing!.id);
    expect(savedUpdates).toHaveLength(1);
    restart();
    await arrive(notice("already-present-copy", firstDate, 97.2, card));
    await processEvent();
    expect(await store.getEventForEmail("owner", "already-present-copy")).toMatchObject({ id: existing!.id,
      status: "settled", operation: null, attemptedAt: null, outcome: existing!.outcome, plan: { reviewReasons: [] } });
    expect(savedUpdates).toHaveLength(1);
    expect(schedule).toMatchObject({ date: nextDate, amountCents: -11_254 });
    expect(await worker.processNextEvent()).toBe(false);
    expect(await worker.getNextWakeAt()).toBeNull();
  });

  it("does not steal a cycle already claimed by another record when two unmapped reviews are configured later", async () => {
    for (const uid of ["unmapped-first", "unmapped-second"]) {
      await arrive(notice(uid, "2026-09-21", 97.2));
      await processEvent();
    }
    const first = (await store.getEventForEmail("owner", "unmapped-first"))!;
    const second = (await store.getEventForEmail("owner", "unmapped-second"))!;
    expect(second.id).not.toBe(first.id);
    expect(savedUpdates).toEqual([]);
    await saveProfiles([utilityProfile]);
    restart();
    expect(await worker.processNextEvent()).toBe(true);
    expect(await worker.processNextEvent()).toBe(true);
    expect(await store.getEventForEmail("owner", "unmapped-first")).toMatchObject({ id: first.id, status: "settled" });
    expect(await store.getEventForEmail("owner", "unmapped-second")).toMatchObject({ id: second.id, status: "needs_review",
      reason: "This billing cycle already belongs to another record. Review its existing entry.", operation: null, attemptedAt: null });
    await arrive(notice("cycle-copy", "2026-09-21", 97.2));
    await processEvent();
    expect(await store.getEventForEmail("owner", "cycle-copy")).toMatchObject({ id: first.id, status: "settled" });
    expect(savedUpdates).toHaveLength(1);
    expect(await worker.processNextEvent()).toBe(false);
  });

  it("updates the card schedule from savings and ignores completed payments and undated reminders", async () => {
    await saveProfiles([cardProfile]);
    await arrive(notice("scheduled-card-payment", "2026-09-25", 251.32, true));
    await processEvent();
    expect(savedUpdates).toMatchObject([{ scheduleId: "card-payment", fromAccountId: "savings", toAccountId: "card",
      date: "2026-09-25", amountCents: 25_132 }]);
    expect(schedules[1]).toMatchObject({ id: "card-payment", date: "2026-09-25", amountCents: -25_132 });
    for (const event_kind of ["card_payment_completed", "payment_due"] as const) {
      const source = notice(event_kind, "2026-09-25", 251.32, true);
      const evidence = event_kind === "payment_due" ? "Your payment is due in five days" : "Your card payment completed";
      source.body = evidence;
      source.candidate = { ...source.candidate, event_kind, event_evidence: evidence, type_evidence: evidence,
        due_date: null, amount: null, amount_candidates: [], provider_reference: null } as BillCandidate;
      await arrive(source);
      expect(await store.getDocumentForEmail("owner", source.uid)).toMatchObject({ status: "ignored", candidate: null, eventId: null, nextAttemptAt: null });
    }
    restart();
    clock += 24 * 60 * 60_000;
    expect(await worker.processNextDocument()).toBe(false);
    expect(await worker.processNextEvent()).toBe(false);
    expect(savedUpdates).toHaveLength(1);
    expect(await worker.getNextWakeAt()).toBeNull();
  });
});
