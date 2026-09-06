import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinancialEventIntake } from "./financial-event-intake.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { seedEmailAccount } from "../email/test-utils/email-index-db.ts";
import { encrypt } from "../platform/encryption.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";

const CUTOVER = "2026-09-01T00:00:00.000Z";
const START = Date.parse("2026-09-02T00:00:00.000Z");
const DAY = 86_400_000;
const POLL = 5 * 60_000;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function message(id: string, { date = "2026-09-01T12:00:00.000Z", inbox = false }: { date?: string; inbox?: boolean } = {}) {
  return { id, threadId: `thread-${id}`, labelIds: inbox ? ["INBOX"] : [], payload: {
    headers: [
      { name: "From", value: "Example Market <receipt@example.test>" },
      { name: "Date", value: date },
      { name: "Subject", value: "Your purchase receipt" },
      { name: "Message-ID", value: `<${id}@example.test>` },
      { name: "Authentication-Results", value: "mx.google.com; dkim=pass header.i=@example.test; dmarc=pass header.from=example.test" },
    ],
    mimeType: "text/plain", body: { data: Buffer.from("Purchase on September 1, 2026. Total $12.00. Card ending 1234.").toString("base64url") },
  } };
}

describe("financial received-email capture", () => {
  let db: Client;
  let now: number;

  beforeEach(async () => {
    vi.stubEnv("EA_ENCRYPTION_KEY", "11".repeat(32));
    db = await createMigratedDb();
    now = START;
    await db.execute({ sql: "UPDATE ea_financial_workflow_state SET cutover_at = ?", args: [CUTOVER] });
    await seedEmailAccount(db, { credentials_encrypted: encrypt(JSON.stringify({
      access_token: "test-token", refresh_token: "test-refresh", expires_at: Date.now() + DAY,
    }), accountCredentialContext("gmail-work")) });
  });
  afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  function intake() { return createFinancialEventIntake({ dbClient: db, now: () => now }); }
  function store() { return createFinancialEventStore(db, () => now); }
  async function state() { return (await db.execute("SELECT * FROM ea_financial_intake_state WHERE account_id = 'gmail-work'")).rows[0]!; }

  it("captures read and filter-archived new receipts without attaching them to Inbox, and excludes pre-cutover mail", async () => {
    const lists: URL[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages")) {
        lists.push(url);
        return response({ messages: ["archived", "inbox", "old", "deleted", "old-header", "future-header"].map((id) => ({ id })) });
      }
      const id = url.pathname.split("/").pop()!;
      if (id === "deleted") return response({}, 404);
      const staleDate = ["old", "old-header"].includes(id) ? "2026-08-31T23:59:59Z" : undefined;
      return response({ ...message(id, { inbox: id === "inbox", date: id === "future-header" ? "2099-01-01T00:00:00Z" : staleDate }),
        ...(["old-header", "future-header"].includes(id) ? { internalDate: String(Date.parse("2026-09-01T12:00:00Z")) } : {}) });
    });
    await intake().recoverStaleClaims();
    expect(await intake().processNextPage()).toBe(true);
    const indexed = await db.execute("SELECT uid, read, email_date FROM ea_email_index ORDER BY uid");
    expect(indexed.rows).toEqual(["archived", "future-header", "inbox", "old-header"].map((id) => ({
      uid: `gmail-gmail-work-${id}`, read: 1, email_date: "2026-09-01T12:00:00.000Z",
    })));
    expect(await store().isManagedEmail("user-1", "gmail-gmail-work-archived")).toBe(true);
    expect((await db.execute("SELECT COUNT(*) AS total FROM ea_email_triage")).rows[0]?.total).toBe(0);
    expect((await db.execute("SELECT COUNT(*) AS total FROM ea_briefing_snapshot_items")).rows[0]?.total).toBe(0);
    expect(await state()).toMatchObject({ status: "waiting", completed_through: new Date(now).toISOString(), unavailable_count: 1, next_attempt_at: now + POLL });
    // The received-mail HTTP query must not inherit the Inbox label restriction.
    expect(lists[0]!.searchParams.get("q")).toBe(`-in:sent -in:drafts -in:spam -in:trash after:${Date.parse(CUTOVER) / 1000 - 1} before:${START / 1000 + 1}`);
    expect(lists[0]!.searchParams.has("labelIds")).toBe(false);
    expect(await intake().processNextPage()).toBe(false);
  });

  it("retains failed pages across a multi-day outage and holds dispatch until capture passes the stable collection deadline", async () => {
    let failSecond = true;
    const windows: Array<{ start: number; end: number }> = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages")) {
        const query = url.searchParams.get("q")!;
        const start = Number(/after:(\d+)/.exec(query)![1]) * 1000;
        const end = Number(/before:(\d+)/.exec(query)![1]) * 1000;
        windows.push({ start, end });
        if (url.searchParams.get("pageToken") === "second") return response({ messages: [{ id: "second" }] });
        if (end <= START + 1000) return response({ messages: [{ id: "first" }], nextPageToken: "second" });
        const gap = START + DAY / 2;
        return response({ messages: start < gap && end > gap ? [{ id: "during-outage" }] : [] });
      }
      const id = url.pathname.split("/").pop()!;
      if (id === "second" && failSecond) return response({}, 503);
      return response(message(id, { date: id === "during-outage" ? new Date(START + DAY / 2).toISOString() : undefined }));
    });
    await intake().recoverStaleClaims();
    await intake().processNextPage();
    const document = await store().claimDocument("first");
    await store().associateDocument(document!, { candidate: { type: "expense", amount: 12 }, contentHash: "first", eventId: "purchase", nextAttemptAt: now + 90_000 });
    await intake().processNextPage();
    expect(await state()).toMatchObject({ status: "retry", completed_through: CUTOVER, window_end: new Date(START).toISOString(), page_token: "second" });
    now += 3 * DAY;
    expect(await store().claimEvent("incomplete")).toBeNull();
    failSecond = false;
    const resumed = intake();
    await resumed.recoverStaleClaims();
    for (let page = 0; page < 6 && await resumed.processNextPage(); page++) { /* finish bounded forward windows */ }
    expect(await state()).toMatchObject({ status: "waiting", completed_through: new Date(now).toISOString(), page_token: null, window_end: null });
    const indexed = await db.execute("SELECT uid FROM ea_email_index ORDER BY uid");
    expect(indexed.rows).toEqual(["during-outage", "first", "second"].map((id) => ({ uid: `gmail-gmail-work-${id}` })));
    for (let document = await store().claimDocument("sibling"); document; document = await store().claimDocument("sibling")) {
      await store().settleDocument(document, { candidate: null, contentHash: "unrelated", status: "ignored" });
    }
    const event = await store().claimEvent("caught-up");
    expect(event).toMatchObject({ id: "purchase", collectionDeadline: START + 90_000 });
    await store().saveEvent(event!, { plan: null, status: "waiting", nextAttemptAt: now + 15 * 60_000 });
    expect((await store().getEventForEmail("user-1", "gmail-gmail-work-first"))?.collectionDeadline).toBe(START + 90_000);
    // The durable capture included the outage interval instead of falling back
    // to the old two-hour Inbox lookback.
    expect(windows.some((window) => window.start < START + DAY / 2 && window.end > START + DAY / 2)).toBe(true);
  });

  it("restarts an expired provider page token in the same window after stale lease recovery without duplicating documents", async () => {
    let expireToken = true;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages")) {
        if (url.searchParams.get("pageToken")) return expireToken ? response({}, 400) : response({ messages: [{ id: "second" }] });
        return response({ messages: [{ id: "first" }], nextPageToken: "second" });
      }
      return response(message(url.pathname.split("/").pop()!));
    });
    await intake().recoverStaleClaims();
    await intake().processNextPage();
    await db.execute({ sql: "UPDATE ea_financial_intake_state SET status = 'processing', claim_token = 'lost', claimed_at = ?", args: [now] });
    now += 15 * 60_000;
    expect(await intake().recoverStaleClaims()).toBe(1);
    await intake().processNextPage();
    expect(await state()).toMatchObject({ status: "retry", completed_through: CUTOVER, window_end: new Date(START).toISOString(), page_token: null });
    now = Number((await state()).next_attempt_at);
    expireToken = false;
    await intake().processNextPage();
    await intake().processNextPage();
    expect((await db.execute("SELECT email_uid, revision FROM ea_financial_documents ORDER BY email_uid")).rows).toEqual([
      { email_uid: "gmail-gmail-work-first", revision: 1 }, { email_uid: "gmail-gmail-work-second", revision: 1 },
    ]);
  });
});
