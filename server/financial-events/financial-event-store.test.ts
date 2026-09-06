import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFinancialEventStore, type FinancialDocument } from "./financial-event-store.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";

const CUTOVER = "2026-09-06T12:00:00Z";
const ARRIVAL = "2026-09-06T12:01:00Z";
const candidate: BillCandidate = { type: "expense", payee: "Example Market", amount: 12, due_date: "2026-09-06", currency: "USD" };
const auth = { version: 1, status: "none", provider: "gmail", source: "gmail_authentication_results", evaluatedAt: ARRIVAL };

function migration(file: string): string {
  return readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8");
}

async function database(includeWorkflow = true): Promise<Client> {
  const client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "054_email_sender_authentication.sql"]) {
    await client.executeMultiple(migration(file));
  }
  if (includeWorkflow) {
    await client.executeMultiple(migration("062_financial_events.sql"));
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

  async function associate(uid: string, eventId = "event-1", nextAttemptAt?: number): Promise<FinancialDocument> {
    await insertEmail(uid);
    const document = await store().claimDocument(`document-${uid}`);
    expect(document?.emailUid).toBe(uid);
    expect(await store().associateDocument(document!, { candidate, eventId, contentHash: uid, nextAttemptAt })).toBe(true);
    return document!;
  }

  it("starts empty and only enrolls newly indexed arrivals after deployment, including iCloud", async () => {
    db.close();
    db = await database(false);
    await insertEmail("already-indexed", { emailDate: "2099-01-01T00:00:00Z", indexedAt: "2099-01-01T00:00:00Z" });
    await db.executeMultiple(migration("062_financial_events.sql"));
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

  it("links related documents into one event and delays execution while new arrivals need assessment", async () => {
    await associate("receipt", "purchase", now + 90_000);
    await insertEmail("confirmation");
    expect(await store().claimEvent("early")).toBeNull();
    const confirmation = await store().claimDocument("confirmation");
    expect(await store().associateDocument(confirmation!, { candidate, contentHash: "confirmation", eventId: "purchase", nextAttemptAt: now + 90_000 })).toBe(true);
    expect((await store().listDocuments("owner", { since: CUTOVER })).map((item) => item.emailUid)).toEqual(["confirmation", "receipt"]);
    expect((await store().listDocuments("owner", { since: ARRIVAL, until: Date.parse(ARRIVAL) })).map((item) => item.emailUid)).toEqual(["confirmation", "receipt"]);
    expect(await store().listDocuments("owner", { until: Date.parse(ARRIVAL) - 1 })).toEqual([]);
    expect(await store().listDocuments("other-owner")).toEqual([]);
    expect(await store().getNextWakeAt()).toBe(now + 90_000);
    now += 90_000;
    const event = await store().claimEvent("event");
    expect(event).toMatchObject({ id: "purchase", revision: 2, documents: [{ emailUid: "receipt" }, { emailUid: "confirmation" }] });
    expect(await store().getEventForEmail("other-owner", "receipt")).toBeNull();
    await insertEmail("possible-cancellation");
    expect(await store().admitOperation(event!, { amountCents: -1200 })).toBe(false);
  });

  it("preserves the admitted operation through interruptions, re-evaluation, and related reminders", async () => {
    await associate("receipt");
    const event = await store().claimEvent("first-event");
    const operation = { kind: "transaction", budgetId: "budget", importedId: "event-1", amountCents: -1200 };
    expect(await store().admitOperation(event!, operation)).toBe(true);
    expect(await store().admitOperation(event!, operation)).toBe(false);
    const attemptedAt = now;
    now += 15 * 60_000;
    expect(await store().recoverStaleClaims()).toEqual({ documents: 0, events: 1 });
    const recovered = await store().claimEvent("recovered");
    expect(recovered).toMatchObject({ operation, attemptedAt });
    expect(await store().admitOperation(recovered!, { ...operation, amountCents: -1500 })).toBe(false);
    expect(await store().saveEvent(event!, { plan: null, status: "settled" })).toBe(false);
    await store().saveEvent(recovered!, { plan: null, status: "settled", outcome: { status: "already_present", transactionId: "actual-1" } });

    await associate("reminder");
    const reminder = await store().claimEvent("reminder-event");
    expect(reminder).toMatchObject({ id: "event-1", operation, attemptedAt, outcome: { status: "already_present" } });
    expect(await store().admitOperation(reminder!, operation)).toBe(false);
    await expect(db.execute("UPDATE ea_financial_events SET operation_json = '{}', attempted_at = 1 WHERE id = 'event-1'")).rejects.toThrow(/immutable/);
    await expect(db.execute("DELETE FROM ea_financial_events WHERE id = 'event-1'")).rejects.toThrow(/retained/);
    expect((await db.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });

  it("rejects dispatch and stale event settlement after linked source evidence changes", async () => {
    await associate("receipt");
    const event = await store().claimEvent("event");
    await db.execute("UPDATE ea_email_index SET body_text = 'Payment cancelled' WHERE uid = 'receipt'");
    expect(await store().admitOperation(event!, { amountCents: -1200 })).toBe(false);
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

  it("requires capture through the fixed collection deadline and permits attempted recovery during unrelated intake outages", async () => {
    await associate("receipt", "purchase", now + 90_000);
    await db.execute({
      sql: `INSERT INTO ea_financial_intake_state (user_id, account_id, completed_through, status, updated_at)
            VALUES ('owner', 'gmail', ?, 'waiting', ?)`, args: [new Date(now).toISOString(), now],
    });
    now += 90_000;
    expect(await store().claimEvent("cursor-too-old")).toBeNull();
    await db.execute({ sql: "UPDATE ea_financial_intake_state SET completed_through = ?", args: [new Date(now).toISOString()] });
    const event = await store().claimEvent("collected");
    expect(event).toMatchObject({ collectionDeadline: now });
    await store().saveEvent(event!, { plan: null, status: "waiting", nextAttemptAt: now + 15 * 60_000 });
    now += 15 * 60_000;
    const retried = await store().claimEvent("stable-deadline");
    expect(retried?.collectionDeadline).toBe(event?.collectionDeadline);
    const operation = { kind: "transaction", id: "purchase" };
    expect(await store().admitOperation(retried!, operation)).toBe(true);
    await store().saveEvent(retried!, { plan: null, status: "waiting", nextAttemptAt: now });
    await db.execute("UPDATE ea_financial_intake_state SET status = 'retry'");
    await insertEmail("unrelated-arrival");
    expect(await store().claimEvent("recover-attempt")).toMatchObject({ operation });
  });
});
