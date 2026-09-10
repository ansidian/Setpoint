import type { Client } from "@libsql/client";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import type { FinancialEmailSource } from "../email/financial-email-source.ts";
import type { EmailAuthenticationProjection } from "../../shared/types/email.ts";
import { createFinancialEventStore } from "./financial-event-store.ts";

const arrival = "2026-09-09T12:00:00.000Z";
const authentication = { status: "pass", evaluatedAt: arrival } as EmailAuthenticationProjection;
const source: FinancialEmailSource = { body: "Invoice attached.\n[PDF page 1]\nTotal due $97.20 on September 21, 2026.",
  fromName: "Utility", fromAddress: "bill@utility.example", subject: "New invoice", emailDate: arrival,
  threadId: null, messageId: null, senderAuthentication: authentication,
  attachments: [{ partId: "2", filename: "invoice.pdf", sha256: "a".repeat(64), bytes: 1000, pages: 1, extractorVersion: "fixture-v1" }] };

describe("durable financial source acquisition", () => {
  let db: Client;
  let now: number;
  function store() { return createFinancialEventStore(db, () => now); }
  beforeEach(async () => {
    db = await createMigratedDb();
    now = Date.parse(arrival);
    await db.execute("UPDATE ea_financial_workflow_state SET cutover_at='2026-09-09T00:00:00Z'");
    await db.execute({ sql: `INSERT INTO ea_email_index (uid,user_id,account_id,account_label,account_email,
      from_name,from_address,subject,body_text,email_date,email_date_utc,indexed_at,sender_authentication_json)
      VALUES ('invoice','owner','mail','Mail','owner@example.test','Utility','bill@utility.example','New invoice',
        'Invoice attached.',?,?,?,?)`, args: [arrival, arrival, arrival, JSON.stringify(authentication)] });
  });
  afterEach(() => db.close());

  it("retains complete PDF evidence and provenance across restarts, unchanged index refreshes and owner revisions", async () => {
    const claim = (await store().claimDocument("first"))!;
    expect(await store().reserveDocumentSource(claim)).toBe(1);
    expect(await store().saveDocumentSource(claim, source)).toBe(true);
    expect(await store().getDocumentForEmail("owner", "invoice")).toMatchObject({ body: source.body, acquiredSource: source });
    await db.execute({ sql: "UPDATE ea_email_index SET body_text='Invoice attached.', sender_authentication_json=? WHERE uid='invoice'",
      args: [JSON.stringify({ ...authentication, evaluatedAt: "2026-09-09T12:30:00Z" })] });
    // Owner confirmation changes a workflow revision without changing source facts.
    await db.execute("UPDATE ea_financial_documents SET revision=revision+1 WHERE email_uid='invoice'");
    expect(await store().getDocumentForEmail("owner", "invoice")).toMatchObject({ body: source.body, acquiredSource: source });
  });

  it.each(["body", "authentication"])("invalidates saved source on a meaningful indexed %s change and rejects stale acquisition", async field => {
    const claim = (await store().claimDocument("first"))!;
    await store().reserveDocumentSource(claim);
    await store().saveDocumentSource(claim, source);
    await db.execute(field === "body" ? "UPDATE ea_email_index SET body_text='Corrected invoice attached.' WHERE uid='invoice'"
      : "UPDATE ea_email_index SET sender_authentication_json='{\"status\":\"fail\"}' WHERE uid='invoice'");
    expect((await store().getDocumentForEmail("owner", "invoice"))?.acquiredSource).toBeNull();
    expect(await store().saveDocumentSource(claim, source)).toBe(false);
  });

  it("reacquires snapshots produced by the old MIME policy with a fresh bounded retry budget", async () => {
    const claim = (await store().claimDocument("first"))!;
    // Simulate a persisted snapshot from the previous parser, before deployment
    // of HTML selection. Its index content and workflow revision are unchanged.
    const oldKey = createHash("sha256").update(JSON.stringify([
      "financial-source-v1", claim.emailUid, claim.fromName, claim.fromAddress, claim.subject,
      claim.body, claim.emailDate, claim.threadId, claim.messageId, { status: "pass" },
    ])).digest("hex");
    const stale = { ...source, body: "[Original MIME text/plain content]\nStale cancellation\n[Original MIME text/html content, converted to text]\nScheduled payment" };
    await db.execute({ sql: `UPDATE ea_financial_documents SET acquired_source_json=?, acquired_source_key=?,
      source_attempt_key=?, source_attempts=3 WHERE email_uid='invoice'`, args: [JSON.stringify(stale), oldKey, oldKey] });
    const current = (await store().getDocumentForEmail("owner", "invoice"))!;
    expect(current.acquiredSource).toBeNull();
    expect(current.body).toBe("Invoice attached.");
    expect(current.revision).toBe(claim.revision);
    expect(await store().reserveDocumentSource(current)).toBe(1);
    expect(await store().saveDocumentSource(current, source)).toBe(true);
    expect((await store().getDocumentForEmail("owner", "invoice"))?.body).toBe(source.body);
  });

  it("charges failed or interrupted source requests across restarts and resets only for changed source evidence", async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const current = store();
      const claim = (await current.claimDocument(`attempt-${attempt}`))!;
      expect(await current.reserveDocumentSource(claim)).toBe(attempt < 4 ? attempt : null);
      await current.settleDocument(claim, { candidate: { type: "bill", event_kind: "bill_issued" }, contentHash: "", status: "retry", nextAttemptAt: now });
    }
    await db.execute("UPDATE ea_email_index SET body_text='A corrected invoice is attached.' WHERE uid='invoice'");
    const claim = (await store().claimDocument("changed"))!;
    expect(await store().reserveDocumentSource(claim)).toBe(1);
  });
});
