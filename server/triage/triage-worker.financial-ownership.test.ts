import { describe, expect, it } from "vitest";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import { processNextEmailTriageJob } from "./triage-worker.ts";

describe("financial workflow ownership during Inbox triage", () => {
  it("preserves the Inbox decision while leaving managed financial planning in its own queue", async () => {
    const dbClient = await createMigratedDb();
    try {
      await queueEmail(dbClient, { subject: "Your receipt", body_text: "Purchase total $12.00", body_snippet: "Purchase total $12.00" });
      await dbClient.execute(`INSERT INTO ea_financial_documents (user_id, account_id, email_uid, created_at, updated_at)
        VALUES ('user-1', 'gmail-work', 'msg-1', 1, 1)`);
      await processNextEmailTriageJob({
        dbClient,
        now: new Date("2026-05-03T12:20:00Z"),
        modelClient: {
          async classify() {
            return { decision: {
              lane: "fyi", category: "finance", urgency: "normal", escalation_badge: null,
              summary: "Purchase receipt", action: "No action needed", deadline_at: null, confidence: 0.99,
              bill_candidate: { type: "expense", payee: "Example Market", amount: 12, currency: "USD", due_date: "2026-05-03", event_kind: "purchase" },
            } };
          },
        },
      });
      expect((await dbClient.execute("SELECT triage_status, lane, financial_email_plan_json FROM ea_email_triage WHERE email_id = 'msg-1'")).rows[0])
        .toEqual({ triage_status: "complete", lane: "fyi", financial_email_plan_json: null });
      expect((await dbClient.execute("SELECT status, candidate_json FROM ea_financial_documents WHERE email_uid = 'msg-1'")).rows[0])
        .toEqual({ status: "pending", candidate_json: null });
      expect((await dbClient.execute("SELECT id FROM ea_transaction_import_items")).rows).toEqual([]);
    } finally {
      dbClient.close();
    }
  });
});
