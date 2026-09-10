import { readFileSync } from "node:fs";
import type { Client } from "@libsql/client";
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


/** Explicit fictional owner authority for receipt-worker scenarios. */
export async function saveReceiptProfile(db: Client, enabled = true): Promise<void> {
  const profiles = enabled ? [{ id: "merchant", name: "Example Merchant", enabled: true, budgetId: "budget-1",
    senderAddresses: ["receipt@merchant.example", "payment@processor.example"],
    merchantName: "Example Merchant Inc.", target: { kind: "expense", accountId: "card", payeeId: "payee-0" } }] : [];
  await db.execute({ sql: `INSERT INTO ea_settings (user_id, actual_budget_sync_id, financial_profiles_json, financial_profiles_revision)
    VALUES ('owner', 'budget-1', ?, 1) ON CONFLICT(user_id) DO UPDATE SET financial_profiles_json = excluded.financial_profiles_json,
    financial_profiles_revision = financial_profiles_revision + 1`, args: [JSON.stringify(profiles)] });
}

export const accounts = [
  { id: "card", name: "Example Rewards Mastercard (3234)", type: "credit" },
  { id: "checking", name: "Everyday Checking (0001)", type: "checking" },
  { id: "savings", name: "Rainy Day Savings (0002)", type: "savings" },
];

export interface LedgerEntry {
  id: string;
  identityKey: string;
  budgetId: string;
  accountId: string;
  amountCents: number;
  date: string;
  payee: string;
  payeeId: string | null;
  transferAccountId?: string;
}


async function addFinancialCorrectionSchema(db: Client): Promise<void> {
  for (const file of ['030_owner_bootstrap.sql', '041_email_transaction_imports.sql', '042_transaction_import_item_subject.sql',
    '053_transaction_import_financial_plans.sql', '055_generic_financial_email_imports.sql',
    '056_generic_financial_email_automation.sql', '058_generic_financial_email_income_automation.sql',
    '059_generic_financial_email_transfer_automation.sql', '063_financial_activity.sql', '064_financial_corrections.sql']) {
    await db.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
  }
}

export async function initializeFinancialEventTestSchema(db: Client): Promise<void> {
    for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql",
      "054_email_sender_authentication.sql", "062_financial_events.sql", "071_financial_event_readiness.sql", "068_financial_candidate_dismissal.sql", "067_financial_event_ai_requests.sql", "069_financial_profiles.sql", "070_financial_document_sources.sql"]) {
      await db.executeMultiple(readFileSync(new URL("../db/migrations/" + file, import.meta.url), "utf8"));
    }
    await addFinancialCorrectionSchema(db);
}
