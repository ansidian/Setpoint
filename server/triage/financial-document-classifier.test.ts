import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import { EMAIL_EVIDENCE_TRUNCATED } from "../email/email-evidence.ts";
import { createFinancialDocumentClassifier } from "./financial-document-classifier.ts";
import type { TriageDb, TriageEmail, TriageFetch } from "./triage-types.ts";

let db: Client;
const evidence = "Order total $30.00. You paid Example Shop on September 6, 2026. Payment method: Example Rewards Mastercard.";
const candidate: BillCandidate = {
  document_role: "processor_receipt", event_kind: "purchase", event_confidence: 0.99,
  event_evidence: "You paid Example Shop on September 6, 2026", due_date: "2026-09-06",
  type: "expense", type_confidence: 0.99, type_evidence: "You paid Example Shop",
  amount: 30, amount_kind: "order_total", currency: "USD",
  amount_candidates: [{ kind: "order_total", value: 30, evidence: "Order total $30.00", confidence: 0.99 }],
  account_hint: "Example Rewards Mastercard", account_hint_confidence: 0.99,
};
const email: TriageEmail = {
  user_id: "owner", account_id: "mailbox", email_id: "receipt",
  from_address: "payments@example.com", subject: "Receipt", body_snippet: "Thank you",
  body_text: `${"Earlier context. ".repeat(600)}\n${evidence}`,
  read: true, dismissed_at: "2026-09-06T12:00:00Z", triage_status: "complete", provider_state: "archived",
};

function response(decision: Record<string, unknown>) {
  return {
    ok: true, status: 200,
    json: async () => ({
      output: [{ type: "function_call", name: "submit_email_triage", arguments: JSON.stringify(decision) }],
      usage: {},
    }),
  };
}

function classifier(fetchImpl: TriageFetch = async () => response({ bill_candidate: candidate })) {
  return createFinancialDocumentClassifier({
    dbClient: db as unknown as TriageDb,
    fetchImpl,
    credentialResolver: async () => "test-key",
  });
}

beforeEach(async () => {
  vi.stubEnv("EA_TRIAGE_CHEAP_MODEL", "");
  vi.stubEnv("EA_TRIAGE_STRONG_MODEL", "");
  db = createClient({ url: ":memory:" });
  await db.execute(`CREATE TABLE ea_settings (
    user_id TEXT PRIMARY KEY, email_triage_mode TEXT,
    email_ai_provider TEXT, email_ai_model TEXT,
    bill_extract_provider TEXT, bill_extract_model TEXT
  )`);
  await db.execute("INSERT INTO ea_settings VALUES ('owner', 'real', 'openai', 'gpt-5.4', 'openai', 'gpt-5.4-mini')");
});

afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
});

describe("independent financial document assessment", () => {
  it("assesses complete source evidence with the strong model despite finished inbox handling", async () => {
    const assessor = classifier(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      return response({
        lane: "noise",
        bill_candidate: request.model === "gpt-5.4" && request.input.includes(evidence) ? candidate : null,
      });
    });

    expect(await assessor.assessFinancialDocument("owner", email)).toMatchObject(candidate);
  });

  it("accepts only an explicit null as a negative financial assessment", async () => {
    expect(await classifier(async () => response({ bill_candidate: null })).assessFinancialDocument("owner", email)).toBeNull();
  });

  it.each([{ decision: {} }, { decision: { bill_candidate: [] } }, { decision: { bill_candidate: "not financial" } }])("rejects malformed candidate decisions: $decision", async ({ decision }) => {
    await expect(classifier(async () => response(decision)).assessFinancialDocument("owner", email)).rejects.toThrow("Financial document assessment returned");
  });

  it("propagates provider failure so the workflow can retry", async () => {
    await expect(classifier(async () => { throw new Error("provider transport failed"); }).assessFinancialDocument("owner", email)).rejects.toThrow("provider transport failed");
  });

  it.each(["paused", "no_model"])("keeps %s mode unavailable instead of reporting a negative assessment", async (mode) => {
    await db.execute({ sql: "UPDATE ea_settings SET email_triage_mode = ? WHERE user_id = 'owner'", args: [mode] });
    const assessor = classifier();
    expect(await assessor.canAssessFinancialDocuments("owner")).toBe(false);
    await expect(assessor.assessFinancialDocument("owner", email)).rejects.toMatchObject({ code: "FINANCIAL_DOCUMENT_ASSESSMENT_UNAVAILABLE" });
  });

  it("propagates a failed mode read instead of defaulting a potentially paused workflow to active", async () => {
    await db.execute("DROP TABLE ea_settings");
    await expect(classifier().assessFinancialDocument("owner", email)).rejects.toThrow();
  });

  it("rejects incomplete source evidence", async () => {
    await expect(classifier().assessFinancialDocument("owner", { ...email, body_text: `${evidence}\n${EMAIL_EVIDENCE_TRUNCATED}` })).rejects.toThrow();
  });

  it("uses the active strong model for verification as well as the initial assessment", async () => {
    const assessor = createFinancialDocumentClassifier({
      dbClient: db as unknown as TriageDb,
      fetchImpl: async () => response({ bill_candidate: { ...candidate, event_kind: "card_payment_completed" } }),
      credentialResolver: async () => "test-key",
      billExtractionProviders: { openai: { extract: async ({ model }) => ({
        fields: model === "gpt-5.4" ? candidate : { ...candidate, event_kind: "card_payment_completed" }, usage: {},
      }) } },
    });

    expect(await assessor.assessFinancialDocument("owner", email)).toMatchObject({
      event_kind: "purchase", type: "expense", type_verification: { status: "corrected", model: "gpt-5.4" },
    });
  });
});
