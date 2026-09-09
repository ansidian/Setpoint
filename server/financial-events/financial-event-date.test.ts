import { describe, expect, it } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { FinancialEvidenceDocument } from "./financial-event-evidence.ts";
import { financialDocumentSupportsDate, resolveFinancialDocumentDate } from "./financial-event-date.ts";

const now = new Date("2026-09-09T12:00:00Z");
function confirmation(candidate: Partial<BillCandidate> = {}, source: Partial<FinancialEvidenceDocument> = {}): FinancialEvidenceDocument {
  return {
    emailUid: "initial-confirmation", eventId: null, fromAddress: "orders@example.com", subject: "Order confirmed",
    body: "Your purchase is confirmed. Total paid: $30.00.", emailDate: "2026-09-07T00:30:00.000Z",
    senderAuthentication: { status: "pass" },
    candidate: { type: "expense", type_confidence: 0.99, type_evidence: "Your purchase is confirmed.",
      event_kind: "purchase", event_confidence: 0.99, event_evidence: "Your purchase is confirmed.",
      document_role: "merchant_receipt", amount: 30, currency: "USD", due_date: null,
      purchase_date_context: { kind: "initial_confirmation_without_date", confidence: 0.99, evidence: "Your purchase is confirmed." },
      ...candidate }, ...source,
  };
}

describe("source-backed purchase confirmation dates", () => {
  it.each([
    ["2026-09-07T00:30:00.000Z", "2026-09-06"],
    ["2026-03-08T07:30:00Z", "2026-03-07"],
    ["2026-03-08T10:30:00Z", "2026-03-08"],
    ["2026-01-01T07:59:00Z", "2025-12-31"],
  ])("uses the original Pacific calendar day for %s, independent of processing time", (emailDate, date) => {
    const source = confirmation({}, { emailDate });
    const candidate = resolveFinancialDocumentDate(source, now)!;
    expect(candidate).toMatchObject({ due_date: date, operation_date_source: {
      kind: "email_date", emailUid: source.emailUid, emailDate, date, timeZone: "America/Los_Angeles",
      evidence: "Your purchase is confirmed.",
    } });
    expect(financialDocumentSupportsDate({ ...source, candidate }, candidate, now)).toBe(true);
  });

  it("preserves explicit dates and allows independent verification to repair the extraction", () => {
    const source = confirmation({ due_date: "2026-09-05" }, { body: "Your purchase is confirmed. Paid on September 5, 2026." });
    expect(resolveFinancialDocumentDate(source, now)).toMatchObject({ due_date: "2026-09-05" });
    expect(resolveFinancialDocumentDate(source, now)?.operation_date_source).toBeUndefined();
    expect(financialDocumentSupportsDate({ ...source, candidate: { ...source.candidate!, due_date: null } }, source.candidate!, now)).toBe(true);
    const unsupported = confirmation({ due_date: "2026-09-04" });
    expect(resolveFinancialDocumentDate(unsupported, now)?.due_date).toBe("2026-09-04");
    expect(financialDocumentSupportsDate(unsupported, unsupported.candidate!, now)).toBe(false);
  });

  it.each<Partial<BillCandidate>>([
    { purchase_date_context: null },
    { purchase_date_context: { kind: "other", confidence: 0.99, evidence: "Your purchase is confirmed." } },
    { purchase_date_context: { kind: "initial_confirmation_without_date", confidence: 0.89, evidence: "Your purchase is confirmed." } },
    { purchase_date_context: { kind: "initial_confirmation_without_date", confidence: 1.1, evidence: "Your purchase is confirmed." } },
    { purchase_date_context: { kind: "initial_confirmation_without_date", confidence: 0.99, evidence: "Ordered today" } },
    { type: "income" }, { type: "bill" }, { type: "transfer" },
    { event_kind: "refund" }, { event_kind: "bill_issued" }, { event_kind: "account_transfer_pending" },
    { document_role: "statement" }, { document_role: "payment_notice" },
    { type_confidence: 0.4 }, { event_confidence: 0.89 }, { event_confidence: 1.1 },
    { type_evidence: "Not in source" }, { event_evidence: "Not in source" },
    { event_verification: { status: "failed", provider: "test", model: "test" } },
  ])("requires grounded, high-confidence purchase timing semantics: %j", (overrides) => {
    expect(resolveFinancialDocumentDate(confirmation(overrides), now)?.due_date).toBeNull();
  });

  it.each(["", "invalid", "2026-09-07", "2026-02-30T00:00:00Z", "2026-09-07T00:30:00", "2026-09-10T12:00:00Z"])("rejects unusable or future source timestamps: %s", (emailDate) => {
    expect(resolveFinancialDocumentDate(confirmation({}, { emailDate }), now)?.due_date).toBeNull();
  });

  it("requires authenticated sources and revalidates source and plan revisions", () => {
    const source = confirmation();
    const planned = resolveFinancialDocumentDate(source, now)!;
    expect(financialDocumentSupportsDate({ ...source, senderAuthentication: { status: "unavailable" } }, planned, now)).toBe(false);
    expect(resolveFinancialDocumentDate(confirmation({}, { senderAuthentication: { status: "unavailable" } }), now)?.due_date).toBeNull();
    expect(financialDocumentSupportsDate(source, { ...planned, type: "income", event_kind: "refund" }, now)).toBe(false);
    expect(financialDocumentSupportsDate(source, { ...planned, purchase_date_context: null }, now)).toBe(false);
    expect(financialDocumentSupportsDate({ ...source, candidate: { ...planned, purchase_date_context: null } }, planned, now)).toBe(false);
    expect(financialDocumentSupportsDate({ ...source, candidate: planned, emailDate: "2026-09-08T12:00:00Z" }, planned, now)).toBe(false);
    const resolved = resolveFinancialDocumentDate({ ...source, candidate: planned, emailDate: "2026-09-08T12:00:00Z" }, now)!;
    expect(resolved).toMatchObject({ due_date: "2026-09-08", operation_date_source: { emailDate: "2026-09-08T12:00:00Z", date: "2026-09-08" } });
  });
});
