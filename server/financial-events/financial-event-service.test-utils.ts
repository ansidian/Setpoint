import type { BillCandidate } from "../../shared/types/bills.ts";

export const day = "2026-09-06";
export const arrival = Date.parse(day + "T18:20:00Z");

export interface Source {
  uid: string;
  from: string;
  body: string;
  candidate: BillCandidate | null;
  receivedOffset?: number;
  authenticated?: boolean;
}

export function receipt(uid: string, { role = "processor_receipt", funding = true, reference = uid,
  value = 30, receivedOffset = 0, authenticated = true }: {
  role?: BillCandidate["document_role"]; funding?: boolean; reference?: string; value?: number;
  receivedOffset?: number; authenticated?: boolean;
} = {}): Source {
  const paid = "Paid $" + value.toFixed(2) + " on " + day;
  const body = "Purchase from Example Merchant Inc. " + paid + ". Reference: " + reference + "."
    + (funding ? " Payment method: Example Rewards Mastercard." : "");
  return {
    uid, body, receivedOffset, authenticated,
    from: role === "merchant_receipt" ? "receipt@merchant.example" : "payment@processor.example",
    candidate: {
      type: "expense", type_confidence: 0.99, type_evidence: "Purchase from Example Merchant Inc.",
      event_kind: "purchase", event_confidence: 0.99, event_evidence: paid,
      document_role: role, payee: "Example Merchant Inc.", payee_hint: "Example Merchant Inc.",
      amount: value, amount_kind: "transaction_amount", currency: "USD", due_date: day,
      amount_candidates: [{ kind: "transaction_amount", value, confidence: 0.99, evidence: "Paid $" + value.toFixed(2) }],
      provider_reference: reference, provider_reference_evidence: "Reference: " + reference,
      provider_reference_confidence: 0.99,
      ...(funding ? { account_hint: "Example Rewards Mastercard", account_hint_confidence: 0.99 } : {}),
    },
  };
}

export function authentication(source: Source) {
  const domain = source.from.split("@")[1];
  const pass = source.authenticated !== false;
  return {
    version: 1, provider: "gmail", source: "gmail_authentication_results", evaluatedAt: new Date(arrival).toISOString(),
    status: pass ? "pass" : "unavailable", headerFromDomain: pass ? domain : null,
    dkim: pass ? [{ result: "pass", domain, aligned: true }] : [],
    spf: pass ? { result: "pass", domain, aligned: true } : null,
    dmarc: pass ? { result: "pass", domain, aligned: true } : null,
  };
}

