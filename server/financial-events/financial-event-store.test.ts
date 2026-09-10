import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFinancialEventStore, type FinancialDocument } from "./financial-event-store.ts";
import type { BillCandidate, BillExtractionProviderResult, BillExtractionRequest, FinancialEmailPlan } from "../../shared/types/bills.ts";

const CUTOVER = "2026-09-06T12:00:00Z";
const ARRIVAL = "2026-09-06T12:01:00Z";
const candidate: BillCandidate = { type: "expense", payee: "Example Market", amount: 12, due_date: "2026-09-06", currency: "USD" };
const auth = { version: 1, status: "none", provider: "gmail", source: "gmail_authentication_results", evaluatedAt: ARRIVAL };
const profile = { id: "market", name: "Market receipts", enabled: true, budgetId: "budget",
  senderAddresses: ["receipt@example.test"], target: { kind: "expense", accountId: "card", payeeId: "market" } };
const authorizedPlan: FinancialEmailPlan = {
  version: 1, identity: { version: 1, status: "resolved", key: "financial-email:fixture" }, candidate,
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

function migration(file: string): string {
  return readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8");
}

async function database(includeWorkflow = true): Promise<Client> {
  const client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "054_email_sender_authentication.sql", "069_financial_profiles.sql"]) {
    await client.executeMultiple(migration(file));
  }
  await client.execute({
    sql: "INSERT INTO ea_settings (user_id, actual_budget_sync_id, financial_profiles_json, financial_profiles_revision) VALUES (?, ?, ?, ?)",
    args: ["owner", "budget", JSON.stringify([profile]), 1],
  });
  if (includeWorkflow) {
    await client.executeMultiple(migration("062_financial_events.sql"));
    await client.executeMultiple(migration("071_financial_event_readiness.sql"));
    await client.executeMultiple(migration("068_financial_candidate_dismissal.sql"));
    await client.executeMultiple(migration("067_financial_event_ai_requests.sql"));
    await addFinancialCorrectionSchema(client);
    await client.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at = ?", args: [CUTOVER] });
  }
  return client;
}

describe("financial event persistence", () => {
  let db: Client;
  let now: number;

  beforeEach(async () => {
    db = await database();
    now = Date.parse(ARRIVAL);
  });
  afterEach(() => db.close());

  function store() { return createFinancialEventStore(db, () => now); }

  async function insertEmail(uid: string, { userId = "owner", accountId = "gmail", emailDate = ARRIVAL, indexedAt = ARRIVAL }: {
    userId?: string; accountId?: string; emailDate?: string; indexedAt?: string;
  } = {}): Promise<void> {
    await db.execute({
      sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email,
              from_name, from_address, subject, body_text, email_date, email_date_utc, indexed_at,
              sender_authentication_json, read)
            VALUES (?, ?, ?, 'Mail', 'owner@example.test', 'Example Market', 'receipt@example.test',
              'Receipt', 'Purchase total $12.00', ?, ?, ?, ?, 1)`,
      args: [uid, userId, accountId, emailDate, new Date(emailDate).toISOString(), indexedAt, JSON.stringify(auth)],
    });
  }

  async function associate(uid: string, eventId = "event-1"): Promise<FinancialDocument> {
    await insertEmail(uid);
    const document = await store().claimDocument(`document-${uid}`);
    expect(document?.emailUid).toBe(uid);
    expect(await store().associateDocument(document!, { candidate, eventId, contentHash: uid })).toBe(true);
    return document!;
  }

  const request: BillExtractionRequest = { model: "fixture", systemPrompt: "Verify payment", content: "Receipt $12", usagePurpose: "verification" };

  it("reuses paid results across store instances while separating exact inputs, stages, models, providers and events", async () => {
    await associate("arrival");
    const event = (await store().claimEvent("claim"))!;
    let credits = 20;
    const send = async () => { credits--; return { fields: candidate, usage: { tokens: 10 } }; };
    expect(await store().createAiRequestRunner(event)("openai", request, send)).toEqual({ fields: candidate, usage: { tokens: 10 } });
    expect(await store().createAiRequestRunner(event)("openai", request, send)).toEqual({ fields: candidate, usage: {} });
    for (const changed of [{ ...request, model: "next-model" }, { ...request, content: "Receipt $15" },
      { ...request, systemPrompt: "Updated instructions" }, { ...request, usagePurpose: "matching" as const }]) {
      await store().createAiRequestRunner(event)("openai", changed, send);
    }
    await store().createAiRequestRunner(event)("anthropic", request, send);
    await store().saveEvent(event, { plan: null, status: "waiting", nextAttemptAt: now + 60_000 });
    await associate("another", "event-2");
    await store().createAiRequestRunner((await store().claimEvent("second"))!)("openai", request, send);
    expect(credits).toBe(13);
    expect(await store().getEventForEmail("owner", "arrival")).toMatchObject({ operation: null, attemptedAt: null });
  });

  it("serializes concurrent spending and retains a late paid response after claim expiry", async () => {
    await associate("arrival");
    const event = (await store().claimEvent("claim"))!;
    let credits = 10;
    let complete!: (value: BillExtractionProviderResult) => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    const first = store().createAiRequestRunner(event)("openai", request, () => {
      credits--; started(); return new Promise((resolve) => { complete = resolve; });
    });
    await sending;
    const send = async () => { credits--; return { fields: {}, usage: {} }; };
    await expect(store().createAiRequestRunner(event)("openai", request, send)).rejects.toThrow("already active");
    now += 15 * 60_000;
    await store().recoverStaleClaims();
    const current = (await store().claimEvent("replacement"))!;
    await expect(store().createAiRequestRunner(event)("openai", { ...request, model: "fresh" }, send)).rejects.toThrow("source claim changed");
    complete({ fields: candidate, usage: { tokens: 10 } });
    await first;
    expect(await store().createAiRequestRunner(current)("openai", request, send)).toEqual({ fields: candidate, usage: {} });
    expect(await store().admitOperation(event, { invalid: true }, authorizedPlan)).toBe(false);
    expect(credits).toBe(9);
    expect(await store().getEventForEmail("owner", "arrival")).toMatchObject({ operation: null, attemptedAt: null });
  });

  it("counts lost responses against the persisted request budget and can retain any late success", async () => {
    await associate("arrival");
    const pending: Array<Promise<BillExtractionProviderResult>> = [];
    const completions: Array<(value: BillExtractionProviderResult) => void> = [];
    let credits = 10;
    for (let attempt = 0; attempt < 3; attempt++) {
      const event = (await store().claimEvent("claim-" + attempt))!;
      let started!: () => void;
      const sending = new Promise<void>((resolve) => { started = resolve; });
      pending.push(store().createAiRequestRunner(event)("openai", request, () => {
        credits--; started(); return new Promise((resolve) => { completions.push(resolve); });
      }));
      await sending;
      now += 15 * 60_000;
      await store().recoverStaleClaims();
    }
    const current = (await store().claimEvent("exhausted"))!;
    const send = async () => { credits--; return { fields: {}, usage: {} }; };
    await expect(store().createAiRequestRunner(current)("openai", request, send)).rejects.toThrow("exhausted");
    for (const complete of completions) complete({ fields: candidate, usage: {} });
    await Promise.all(pending);
    expect(await store().createAiRequestRunner(current)("openai", request, send)).toEqual({ fields: candidate, usage: {} });
    expect(credits).toBe(7);
  });

  it("starts empty and only enrolls newly indexed arrivals after deployment, including iCloud", async () => {
    db.close();
    db = await database(false);
    await insertEmail("already-indexed", { emailDate: "2099-01-01T00:00:00Z", indexedAt: "2099-01-01T00:00:00Z" });
    await db.executeMultiple(migration("062_financial_events.sql"));
    await db.executeMultiple(migration("071_financial_event_readiness.sql"));
    await db.executeMultiple(migration("068_financial_candidate_dismissal.sql"));
    await db.executeMultiple(migration("067_financial_event_ai_requests.sql"));
    await addFinancialCorrectionSchema(db);
    await db.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at = ?", args: [CUTOVER] });
    expect(await store().getNextWakeAt()).toBeNull();
    expect(await store().isManagedEmail("owner", "already-indexed")).toBe(false);

    await db.execute("UPDATE ea_email_index SET body_text = 'Re-fetched receipt with new evidence' WHERE uid = 'already-indexed'");
    await insertEmail("late-old-mail", { emailDate: "2026-09-05T00:00:00Z" });
    await insertEmail("old-index-time", { indexedAt: "2026-09-05T00:00:00Z" });
    await insertEmail("icloud-arrival", { accountId: "icloud" });
    expect(await store().isManagedEmail("owner", "already-indexed")).toBe(false);
    expect(await store().isManagedEmail("owner", "late-old-mail")).toBe(false);
    expect(await store().isManagedEmail("owner", "old-index-time")).toBe(false);
    expect(await store().isManagedEmail("another-owner", "icloud-arrival")).toBe(false);
    expect(await store().claimDocument("claim")).toMatchObject({
      emailUid: "icloud-arrival", accountId: "icloud", revision: 1,
      emailDate: new Date(ARRIVAL).toISOString(), body: "Purchase total $12.00", senderAuthentication: auth,
    });
  });

  it("persists negative completion independently of read, dismiss, snooze, and absent triage candidates", async () => {
    await insertEmail("arrival");
    await db.batch([
      { sql: "INSERT INTO ea_dismissed_emails (user_id, email_id) VALUES ('owner', 'arrival')", args: [] },
      { sql: "INSERT INTO ea_snoozed_emails (user_id, email_id, until_ts) VALUES ('owner', 'arrival', ?)", args: [now + 86_400_000] },
      { sql: "INSERT INTO ea_email_triage (user_id, account_id, email_id, triage_status) VALUES ('owner', 'gmail', 'arrival', 'complete')", args: [] },
    ]);
    const document = await store().claimDocument("claim");
    expect(document?.emailUid).toBe("arrival");
    expect(await store().settleDocument(document!, { candidate: null, contentHash: "negative-v1", status: "ignored" })).toBe(true);
    expect(await store().claimDocument("again")).toBeNull();
    expect(await store().getNextWakeAt()).toBeNull();
    const saved = await db.execute("SELECT status, content_hash, candidate_json, processed_revision FROM ea_financial_documents");
    expect(saved.rows).toEqual([{ status: "ignored", content_hash: "negative-v1", candidate_json: null, processed_revision: 1 }]);
  });

  it("revisits changed evidence or authentication while ignoring UI and evaluatedAt churn", async () => {
    await associate("arrival");
    const event = await store().claimEvent("event");
    await store().saveEvent(event!, { plan: null, status: "waiting", nextAttemptAt: now + 60_000 });
    await db.execute({
      sql: "UPDATE ea_email_index SET read = 0, body_snippet = 'New preview', sender_authentication_json = ? WHERE uid = 'arrival'",
      args: [JSON.stringify({ ...auth, evaluatedAt: "2026-09-06T12:02:00Z" })],
    });
    expect(await store().claimDocument("unchanged")).toBeNull();
    expect((await store().getEventForEmail("owner", "arrival"))?.status).toBe("waiting");

    await db.execute({ sql: "UPDATE ea_email_index SET sender_authentication_json = ? WHERE uid = 'arrival'", args: [JSON.stringify({ ...auth, status: "pass" })] });
    expect(await store().claimEvent("must-wait")).toBeNull();
    const changed = await store().claimDocument("changed");
    expect(changed).toMatchObject({ revision: 2, processedRevision: 1, eventId: "event-1", senderAuthentication: { status: "pass" } });
    await store().associateDocument(changed!, { candidate, contentHash: "auth-v2", eventId: "event-1" });
    expect(await store().claimEvent("replan")).toMatchObject({ id: "event-1", documents: [{ revision: 2, processedRevision: 2 }] });
  });

  it("serializes document claims per owner and rejects outdated evidence without losing the new work", async () => {
    await insertEmail("first");
    await insertEmail("second");
    await insertEmail("other", { userId: "other-owner" });
    const first = await store().claimDocument("one");
    const other = await store().claimDocument("two");
    expect(first?.emailUid).toBe("first");
    expect(other?.emailUid).toBe("other");
    expect(await store().claimDocument("three")).toBeNull();
    expect(await store().getNextWakeAt()).toBeNull();
    await db.execute("UPDATE ea_email_index SET body_text = 'Corrected total $15.00' WHERE uid = 'first'");
    expect(await store().associateDocument(first!, { candidate, contentHash: "stale", eventId: "wrong-event" })).toBe(false);
    expect(await store().getEventForEmail("owner", "first")).toBeNull();
    const current = await store().claimDocument("current");
    expect(current).toMatchObject({ emailUid: "first", revision: 2, body: "Corrected total $15.00" });
    expect(await store().settleDocument({ ...current!, claimToken: "wrong-token" }, { candidate: null, contentHash: "wrong", status: "ignored" })).toBe(false);
    expect(await store().settleDocument(current!, { candidate: null, contentHash: "current", status: "ignored" })).toBe(true);
    expect((await store().claimDocument("next"))?.emailUid).toBe("second");
  });

  it("links related documents as they arrive without making unrelated assessment an admission gate", async () => {
    await associate("receipt", "purchase");
    await insertEmail("confirmation");
    const early = await store().claimEvent("early");
    expect(early).toMatchObject({ id: "purchase" });
    const confirmation = await store().claimDocument("confirmation");
    expect(await store().associateDocument(confirmation!, { candidate, contentHash: "confirmation", eventId: "purchase" })).toBe(true);
    expect(await store().admitOperation(early!, { amountCents: -1200 }, authorizedPlan)).toBe(false);
    expect(await store().saveEvent(early!, { plan: null, status: "waiting" })).toBe(false);
    expect((await store().listDocuments("owner", { since: CUTOVER })).map((item) => item.emailUid)).toEqual(["confirmation", "receipt"]);
    expect((await store().listDocuments("owner", { since: ARRIVAL, until: Date.parse(ARRIVAL) })).map((item) => item.emailUid)).toEqual(["confirmation", "receipt"]);
    expect(await store().listDocuments("owner", { until: Date.parse(ARRIVAL) - 1 })).toEqual([]);
    expect(await store().listDocuments("other-owner")).toEqual([]);
    expect(await store().getNextWakeAt()).toBe(now);
    const event = await store().claimEvent("event");
    expect(event).toMatchObject({ id: "purchase", revision: 2, documents: [{ emailUid: "receipt" }, { emailUid: "confirmation" }] });
    expect(await store().getEventForEmail("other-owner", "receipt")).toBeNull();
    await insertEmail("possible-cancellation");
    expect(await store().admitOperation(event!, { amountCents: -1200 }, authorizedPlan)).toBe(true);
  });

  it("requires current profile authority for automatic admission without consuming a rejected attempt", async () => {
    await associate("receipt");
    const event = (await store().claimEvent("automatic"))!;
    const operation = { kind: "transaction", budgetId: "budget", amountCents: -1200 };
    expect(await store().admitOperation(event, operation)).toBe(false);
    for (const profile of [
      { ...authorizedPlan.profile!, status: "missing" as const },
      { ...authorizedPlan.profile!, revision: 0 },
      { ...authorizedPlan.profile!, budgetId: "old-budget" },
    ]) expect(await store().admitOperation(event, operation, { ...authorizedPlan, profile })).toBe(false);
    expect(await store().getEventForEmail("owner", "receipt")).toMatchObject({ operation: null, attemptedAt: null });
    expect(await store().admitOperation(event, operation, authorizedPlan)).toBe(true);
    expect(await store().getEventForEmail("owner", "receipt")).toMatchObject({ operation, attemptedAt: now, plan: authorizedPlan });
  });

  it("preserves provider backoff without a saved plan when profiles change", async () => {
    await associate("provider-backoff");
    const event = (await store().claimEvent("provider-failed"))!;
    const retryAt = now + 15 * 60_000;
    await store().saveEvent(event, { plan: null, status: "waiting", nextAttemptAt: retryAt });
    await db.execute("UPDATE ea_settings SET financial_profiles_revision = financial_profiles_revision + 1 WHERE user_id = 'owner'");

    expect(await store().getNextWakeAt()).toBe(retryAt);
    expect(await store().claimEvent("too-early")).toBeNull();
    expect(await store().getEventForEmail("owner", "provider-backoff")).toMatchObject({
      status: "waiting", plan: null, nextAttemptAt: retryAt, operation: null, attemptedAt: null,
    });
    now = retryAt;
    expect(await store().claimEvent("retry")).toMatchObject({ id: event.id, status: "processing", plan: null });
  });

  it("preserves the admitted operation through interruptions, re-evaluation, and related evidence", async () => {
    await associate("receipt");
    const event = await store().claimEvent("first-event");
    const operation = { kind: "transaction", budgetId: "budget", importedId: "event-1", amountCents: -1200 };
    expect(await store().admitOperation(event!, operation, authorizedPlan)).toBe(true);
    expect(await store().admitOperation(event!, operation, authorizedPlan)).toBe(false);
    const attemptedAt = now;
    now += 15 * 60_000;
    expect(await store().recoverStaleClaims()).toEqual({ documents: 0, events: 1 });
    const recovered = await store().claimEvent("recovered");
    expect(recovered).toMatchObject({ operation, attemptedAt });
    expect(await store().admitOperation(recovered!, { ...operation, amountCents: -1500 }, authorizedPlan)).toBe(false);
    expect(await store().saveEvent(event!, { plan: null, status: "settled" })).toBe(false);
    await store().saveEvent(recovered!, { plan: null, status: "settled", outcome: { status: "already_present", transactionId: "actual-1" } });

    await associate("reminder");
    const reminder = await store().claimEvent("reminder-event");
    expect(reminder).toMatchObject({ id: "event-1", operation, attemptedAt, outcome: { status: "already_present" } });
    expect(await store().admitOperation(reminder!, operation, authorizedPlan)).toBe(false);
    await expect(db.execute("UPDATE ea_financial_events SET operation_json = '{}', attempted_at = 1 WHERE id = 'event-1'")).rejects.toThrow(/immutable/);
    await expect(db.execute("DELETE FROM ea_financial_events WHERE id = 'event-1'")).rejects.toThrow(/retained/);
    expect((await db.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });

  it("rejects dispatch and stale event settlement after linked source evidence changes", async () => {
    await associate("receipt");
    const event = await store().claimEvent("event");
    await db.execute("UPDATE ea_email_index SET body_text = 'Payment cancelled' WHERE uid = 'receipt'");
    expect(await store().admitOperation(event!, { amountCents: -1200 }, authorizedPlan)).toBe(false);
    expect(await store().saveEvent(event!, { plan: null, status: "settled", outcome: { status: "added" } })).toBe(false);
    expect(await store().claimEvent("still-dirty")).toBeNull();
    const document = await store().claimDocument("cancelled");
    await store().settleDocument(document!, { candidate: null, contentHash: "cancelled", status: "ignored" });
    expect(await store().claimEvent("reconsider")).toMatchObject({ operation: null, outcome: null, documents: [{ candidate: null }] });
  });

  it("retains reference aliases beyond the correlation window and rejects conflicting event bindings", async () => {
    await insertEmail("merchant");
    const merchant = await store().claimDocument("merchant");
    await store().associateDocument(merchant!, { candidate, contentHash: "merchant", eventId: "purchase", referenceKey: "merchant-order" });
    await insertEmail("processor");
    const processor = await store().claimDocument("processor");
    await store().associateDocument(processor!, { candidate, contentHash: "processor", eventId: "purchase", referenceKey: "processor-transaction" });
    now += 31 * 86_400_000;
    expect(await store().listDocuments("owner", { since: now - 5 * 60_000, until: now + 5 * 60_000 })).toEqual([]);
    expect(await store().findEventsByReference("owner", "processor-transaction")).toEqual(["purchase"]);
    expect(await store().findEventsByReference("another-owner", "processor-transaction")).toEqual([]);

    await db.execute("UPDATE ea_email_index SET body_text = 'Updated processor reference' WHERE uid = 'processor'");
    const updated = await store().claimDocument("updated");
    await store().associateDocument(updated!, { candidate, contentHash: "processor-v2", eventId: "purchase", referenceKey: "processor-replacement" });
    await db.execute("UPDATE ea_email_index SET body_text = 'Nonfinancial followup' WHERE uid = 'processor'");
    const ignored = await store().claimDocument("ignored");
    await store().settleDocument(ignored!, { candidate: null, contentHash: "nonfinancial", status: "ignored" });
    expect(await store().findEventsByReference("owner", "processor-transaction")).toEqual(["purchase"]);
    expect(await store().findEventsByReference("owner", "processor-replacement")).toEqual(["purchase"]);

    await insertEmail("repeat", { emailDate: new Date(now).toISOString() });
    const repeat = await store().claimDocument("repeat");
    expect(await store().associateDocument(repeat!, { candidate, contentHash: "repeat", eventId: "forked", referenceKey: "processor-transaction" })).toBe(false);
    expect(await store().getEventForEmail("owner", "repeat")).toBeNull();
    expect(await store().associateDocument(repeat!, { candidate, contentHash: "repeat", eventId: "purchase", referenceKey: "processor-transaction" })).toBe(true);
    expect((await store().getEventForEmail("owner", "repeat"))?.id).toBe("purchase");
    expect((await db.execute("SELECT id FROM ea_financial_events")).rows).toEqual([{ id: "purchase" }]);
  });

  it("invalidates an associated event when reassessment completes with no financial candidate", async () => {
    await associate("receipt");
    const original = await store().claimEvent("original");
    await store().saveEvent(original!, { plan: null, status: "settled" });
    await db.execute("UPDATE ea_financial_documents SET status = 'pending' WHERE email_uid = 'receipt'");
    const reassessment = await store().claimDocument("reassessment");
    await store().settleDocument(reassessment!, { candidate, contentHash: "not-financial", status: "ignored" });
    const refreshed = await store().getEventForEmail("owner", "receipt");
    expect(refreshed).toMatchObject({ status: "pending", revision: original!.revision + 1, documents: [{ candidate: null, status: "ignored" }] });
  });

  it("recovers document leases and observes durable retry deadlines across store instances", async () => {
    await insertEmail("receipt");
    const first = await store().claimDocument("first");
    expect(await store().recoverStaleClaims()).toEqual({ documents: 0, events: 0 });
    now += 15 * 60_000;
    expect(await store().recoverStaleClaims()).toEqual({ documents: 1, events: 0 });
    const retry = await store().claimDocument("retry");
    expect(retry).toMatchObject({ emailUid: "receipt", attempts: 2 });
    expect(await store().settleDocument(first!, { candidate: null, contentHash: "lost", status: "ignored" })).toBe(false);
    await store().settleDocument(retry!, { candidate: null, contentHash: "pending", status: "retry", nextAttemptAt: now + 30_000, error: "Provider unavailable" });
    expect(await store().claimDocument("too-soon")).toBeNull();
    expect(await store().getNextWakeAt()).toBe(now + 30_000);
    now += 30_000;
    expect(await store().claimDocument("due")).toMatchObject({ emailUid: "receipt", error: "Provider unavailable", attempts: 3 });
  });

  it("ignores legacy collection deadlines and unrelated intake outages for planning, admission and recovery", async () => {
    await associate("receipt", "purchase");
    await db.execute({ sql: "UPDATE ea_financial_events SET collection_required = 1, collection_deadline = ? WHERE id = 'purchase'", args: [now + 90_000] });
    await db.execute({
      sql: `INSERT INTO ea_financial_intake_state (user_id, account_id, completed_through, status, updated_at)
            VALUES ('owner', 'gmail', ?, 'retry', ?)`, args: [new Date(now - 86400_000).toISOString(), now],
    });
    await insertEmail("unrelated-arrival");
    const event = await store().claimEvent("ready");
    expect(event).toMatchObject({ id: "purchase", attemptedAt: null });
    await store().saveEvent(event!, { plan: null, status: "waiting", nextAttemptAt: now + 15 * 60_000 });
    now += 15 * 60_000;
    const retried = await store().claimEvent("operational-retry");
    const operation = { kind: "transaction", id: "purchase" };
    expect(await store().admitOperation(retried!, operation, authorizedPlan)).toBe(true);
    await store().saveEvent(retried!, { plan: null, status: "waiting", nextAttemptAt: now });
    expect(await store().claimEvent("recover-attempt")).toMatchObject({ operation });
  });

  it("keeps a candidate needing owner review suspended until its source changes", async () => {
    await insertEmail("ambiguous");
    const document = await store().claimDocument("assess");
    await store().settleDocument(document!, { candidate, contentHash: "ambiguous-v1", status: "retry", nextAttemptAt: null,
      error: "Waiting for evidence that distinguishes similar purchases." });
    now += 24 * 3600_000;
    expect(await store().getDocumentForEmail("owner", "ambiguous")).toMatchObject({ status: "retry", candidate, nextAttemptAt: null });
    expect(await store().claimDocument("restart")).toBeNull();
    expect(await store().getNextWakeAt()).toBeNull();
    await db.execute("UPDATE ea_email_index SET body_text = 'A distinct reference identifies this $12.00 purchase' WHERE uid = 'ambiguous'");
    expect(await store().claimDocument("changed-source")).toMatchObject({ emailUid: "ambiguous", revision: 2 });
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
