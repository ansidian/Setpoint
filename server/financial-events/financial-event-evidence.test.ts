import { describe, expect, it } from "vitest";
import { combineFinancialEventEvidence, correlateFinancialDocument, type FinancialEvidenceDocument } from "./financial-event-evidence.ts";

function receipt(uid: string, role: "merchant_receipt" | "processor_receipt", overrides: Partial<FinancialEvidenceDocument> = {}): FinancialEvidenceDocument {
  const provider_reference = `${role}-${uid}`;
  return {
    emailUid: uid, eventId: null, fromAddress: `${role}@example.com`,
    subject: "Purchase receipt", emailDate: "2026-09-07T12:00:00Z", body: `Example Merchant Inc. Paid $30.00 on September 7, 2026. Payment method: Example Rewards Card. Reference: ${provider_reference}`,
    senderAuthentication: { status: "pass" },
    candidate: { document_role: role, type: "expense", type_confidence: 0.99, type_evidence: "Paid $30.00", event_kind: "purchase", event_confidence: 0.99,
      event_evidence: "Paid $30.00 on September 7, 2026.", amount: 30, amount_kind: "transaction_amount", due_date: "2026-09-07", currency: "USD",
      payee_hint: "Example Merchant Inc.", provider_reference, provider_reference_evidence: provider_reference, provider_reference_confidence: 0.99,
      ...(role === "processor_receipt" ? { account_hint: "Example Rewards Card", account_hint_confidence: 0.99 } : {}),
    }, ...overrides,
  };
}

describe("financial event evidence identity", () => {
  it("joins a unique complementary processor receipt and preserves funding evidence", () => {
    const merchant = receipt("m1", "merchant_receipt", { eventId: "event-1" });
    const processor = receipt("p1", "processor_receipt");
    expect(correlateFinancialDocument(processor, [merchant])).toEqual({ eventId: "event-1", ambiguous: false });
    const combined = combineFinancialEventEvidence([merchant, processor]);
    expect(combined).toMatchObject({ authenticated: true, conflict: false, candidate: { amount: 30, account_hint: "Example Rewards Card" } });
    expect(combined.body).toContain(merchant.body);
    expect(combined.body).toContain(processor.body);
  });

  it("never merges two same-day purchases or chooses among competing receipts", () => {
    const first = receipt("m1", "merchant_receipt", { eventId: "first" });
    const second = receipt("m2", "merchant_receipt", { eventId: "second" });
    expect(correlateFinancialDocument(second, [first])).toEqual({ eventId: "second", ambiguous: false });
    expect(correlateFinancialDocument(receipt("p1", "processor_receipt"), [first, second])).toEqual({ eventId: null, ambiguous: true });
    const processor = receipt("p1", "processor_receipt", { eventId: "first" });
    expect(correlateFinancialDocument(receipt("p2", "processor_receipt"), [first, processor])).toEqual({ eventId: null, ambiguous: true });
  });

  it("converges repeated provider references but separates purchase and refund identities", () => {
    const first = receipt("m1", "merchant_receipt", { eventId: "first" });
    const repeated = { ...first, emailUid: "another-mail", eventId: null };
    expect(correlateFinancialDocument(repeated, [first])).toEqual({ eventId: "first", ambiguous: false });
    const refund = { ...repeated, candidate: { ...repeated.candidate!, type: "income", event_kind: "refund" as const } };
    expect(correlateFinancialDocument(refund, [first])).toEqual({ eventId: null, ambiguous: false });
  });

  it("cannot borrow account evidence from unauthenticated or contradictory documents", () => {
    const merchant = receipt("m1", "merchant_receipt");
    const processor = receipt("p1", "processor_receipt", { senderAuthentication: { status: "unavailable" } });
    expect(combineFinancialEventEvidence([merchant, processor]).candidate?.account_hint).toBeUndefined();
    const altered = receipt("p2", "processor_receipt");
    altered.candidate = { ...altered.candidate, amount: 300 };
    expect(combineFinancialEventEvidence([merchant, altered]).conflict).toBe(true);
  });
});
