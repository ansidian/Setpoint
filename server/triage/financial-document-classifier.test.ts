import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import admissionCases from "./fixtures/financial-admission.json" with { type: "json" };
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
  it.each(admissionCases)("applies the grounded admission audit without losing incomplete events: $name", async (fixture) => {
    // Use an unknown sender to exercise AI admission even for templates which
    // have separate deterministic coverage. The provider is the only substitute.
    const initial: BillCandidate = { type: fixture.eventKind === "refund" ? "income" : fixture.eventKind === "bill_issued" ? "bill" : "expense",
      event_kind: (fixture.eventKind || "purchase") as BillCandidate["event_kind"], event_confidence: 0.99,
      event_evidence: fixture.evidence, type_confidence: 0.99, type_evidence: fixture.evidence,
      amount: null, currency: null, due_date: null };
    const assessor = createFinancialDocumentClassifier({dbClient:db as unknown as TriageDb,
      fetchImpl:async()=>response({bill_candidate:initial}),credentialResolver:async()=>"test-key",
      billExtractionProviders:{openai:{extract:async()=>({fields:{...initial,event_assessment:{
        outcome:fixture.expected as "financial_event"|"nonfinancial",evidence:fixture.evidence}},usage:{}})}}});
    const assessed=await assessor.assessFinancialDocument("owner",{...email,from_address:"notices@unknown.example",subject:fixture.source.subject,body_text:fixture.source.body});
    if(fixture.expected === "nonfinancial") expect(assessed).toBeNull();
    else expect(assessed).toMatchObject({event_kind:fixture.eventKind,amount:null,due_date:null,event_verification:{assessment:{outcome:"financial_event"}}});
  });
  it.each(["uncertain", "ungrounded", "missing", "failure"])("retains a candidate when the audit is %s", async (mode) => {
    const assessor=createFinancialDocumentClassifier({dbClient:db as unknown as TriageDb,
      fetchImpl:async()=>response({bill_candidate:candidate}),credentialResolver:async()=>"test-key",
      billExtractionProviders:{openai:{extract:async()=>{
        if(mode === "failure") throw new Error("Provider unavailable");
        return {fields:{...candidate,...(mode === "missing" ? {} : {event_assessment:{
          outcome:mode === "uncertain" ? "uncertain" as const : "nonfinancial" as const,
          evidence:mode === "ungrounded" ? "This quote is not in the source" : null}})},usage:{}};
      }}}});
    const assessed=await assessor.assessFinancialDocument("owner",email);
    expect(assessed).toMatchObject({event_kind:"purchase",event_verification:mode === "failure"
      ? {status:"failed"} : {assessment:{outcome:"uncertain"}}});
  });
  it("rejects a confident purchase interpretation when the audit establishes a fulfillment-only notice", async () => {
    const body = "Purchases. The seller is packing your order! Order number: ORDER-104. Estimated delivery: September 22.";
    const assessor = createFinancialDocumentClassifier({
      dbClient: db as unknown as TriageDb,
      fetchImpl: async () => response({ bill_candidate: { ...candidate, event_evidence: "The seller is packing your order!", type_evidence: "Purchases" } }),
      credentialResolver: async () => "test-key",
      billExtractionProviders: { openai: { extract: async () => ({ fields: { ...candidate,
        event_assessment: { outcome: "nonfinancial", evidence: "The seller is packing your order!" } }, usage: {} }) } },
    });
    expect(await assessor.assessFinancialDocument("owner", { ...email, subject: "Order update", body_text: body })).toBeNull();
  });
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
      fetchImpl: async () => response({ bill_candidate: { ...candidate, event_kind: "refund" } }),
      credentialResolver: async () => "test-key",
      billExtractionProviders: { openai: { extract: async ({ model }) => ({
        fields: model === "gpt-5.4" ? candidate : { ...candidate, event_kind: "refund" }, usage: {},
      }) } },
    });

    expect(await assessor.assessFinancialDocument("owner", email)).toMatchObject({
      event_kind: "purchase", type: "expense", type_verification: { status: "corrected", model: "gpt-5.4" },
    });
  });
});
