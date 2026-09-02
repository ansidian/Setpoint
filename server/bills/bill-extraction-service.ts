import db from "../db/connection.ts";
import type { Client } from "@libsql/client";
import { trimBillBody } from "./bill-extract.ts";
import { verifyBillAmounts } from "./billAmountVerifier.ts";
import { verifyBillEvent } from "./billEventVerifier.ts";
import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS } from "./bill-semantic-prompt.ts";
import { ANTHROPIC_PROVIDER } from "./bill-extractors/anthropic.ts";
import { OPENAI_PROVIDER } from "./bill-extractors/openai.ts";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  resolveBillExtractModelConfig,
} from "./bill-extractors/catalog.ts";
import { EMPTY_ACTUAL_METADATA, getMetadata } from "../actual/actual-metadata-projection.ts";
import type {
  BillCandidate,
  BillExtractionInput,
  BillExtractionProvider,
  BillPayMetadata,
} from "../../shared/types/bills.ts";

type HttpError = Error & { status?: number };

const PROVIDERS: Record<string, BillExtractionProvider & { id: string; envVar: string }> = {
  [ANTHROPIC_PROVIDER.id]: ANTHROPIC_PROVIDER,
  [OPENAI_PROVIDER.id]: OPENAI_PROVIDER,
};

export interface BillExtractionDependencies {
  dbClient?: Pick<Client, "execute">;
  metadataReader?: typeof getMetadata;
  providers?: typeof PROVIDERS;
}

export interface BillCandidateExtractionResult {
  candidate: BillCandidate;
  provider: string;
  model: string;
  metadata: BillPayMetadata;
}

export async function loadBillExtractChoice(
  userId: string,
  { dbClient = db }: Pick<BillExtractionDependencies, "dbClient"> = {},
): Promise<{ provider: string; model: string }> {
  try {
    const result = await dbClient.execute({
      sql: "SELECT bill_extract_provider, bill_extract_model FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    const row = result.rows?.[0];
    return resolveBillExtractModelConfig({
      provider: row?.bill_extract_provider,
      model: row?.bill_extract_model,
    });
  } catch {
    return { provider: DEFAULT_BILL_EXTRACT_PROVIDER, model: DEFAULT_BILL_EXTRACT_MODEL };
  }
}

export async function extractBillCandidate(
  userId: string,
  { subject, from, body }: BillExtractionInput,
  {
    dbClient = db,
    metadataReader = getMetadata,
    providers = PROVIDERS,
  }: BillExtractionDependencies = {},
): Promise<BillCandidateExtractionResult> {
  const metadata = await metadataReader(userId).catch(() => EMPTY_ACTUAL_METADATA);
  const categories = metadata.categories || [];
  const accounts = metadata.accounts || [];
  const payees = metadata.payees || [];

  const catCodeToId = new Map<string, string>();
  const catList: string[] = [];
  if (Array.isArray(categories)) {
    let i = 1;
    for (const group of categories) {
      for (const c of group.categories || []) {
        const code = `c${i++}`;
        catCodeToId.set(code, c.id);
        catList.push(`${code}:${c.name}`);
      }
    }
  }
  const acctCodeToId = new Map<string, string>();
  const acctList: string[] = [];
  if (Array.isArray(accounts)) {
    let i = 1;
    for (const a of accounts) {
      const code = `a${i++}`;
      acctCodeToId.set(code, a.id);
      acctList.push(`${code}:${a.name}`);
    }
  }

  const trimmed = trimBillBody({ subject, from, body });
  const systemPrompt = `Extract bill fields from an email. Return submit_bill with:
- payee, due_date (YYYY-MM-DD)
${BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS}
- type: "transfer" (credit card payment), "bill" (recurring), "expense" (one-off), "income"
- category_code: closest category's code (c1, c2, ...) if confident, else null
- category_name: the category's display name (copied from the list)
- to_account_code: ONLY for type=transfer, code (a1, a2, ...) of the credit card being paid. Match on Visa/MC/Amex or last-4 digits. Null if unsure.${catList.length ? `\n\nCategories: ${catList.join(", ")}` : ""}${acctList.length ? `\n\nAccounts: ${acctList.join(", ")}` : ""}`;

  const { provider: providerId, model } = await loadBillExtractChoice(userId, { dbClient });
  const provider = providers[providerId];
  if (!provider) {
    const err: HttpError = new Error(`Unknown bill-extract provider: ${providerId}`);
    err.status = 400;
    throw err;
  }
  const firstPass = await provider.extract({
    model,
    systemPrompt,
    content: trimmed,
  });
  const verification = await verifyBillAmounts({
    content: trimmed,
    candidate: firstPass.fields,
    provider,
    providerId,
    model,
  });
  const eventVerification = await verifyBillEvent({
    content: trimmed,
    candidate: verification.candidate,
    provider,
    providerId,
    model,
  });
  const fields = eventVerification.candidate;
  const usage = firstPass.usage;

  console.log(
    `[EA] Bill extract: provider=${providerId} model=${model} in=${usage.input_tokens ?? usage.prompt_tokens ?? "?"} out=${usage.output_tokens ?? usage.completion_tokens ?? "?"} trimmed_chars=${trimmed.length}`,
  );

  const candidate: BillCandidate = {
    payee: fields.payee,
    amount: fields.amount,
    ...(fields.amount_kind ? { amount_kind: fields.amount_kind } : {}),
    ...(Array.isArray(fields.amount_candidates) && fields.amount_candidates.length
      ? { amount_candidates: fields.amount_candidates }
      : {}),
    ...(fields.amount_verification ? { amount_verification: fields.amount_verification } : {}),
    ...(fields.event_kind ? { event_kind: fields.event_kind } : {}),
    ...(fields.event_confidence != null ? { event_confidence: fields.event_confidence } : {}),
    ...(fields.event_evidence ? { event_evidence: fields.event_evidence } : {}),
    ...(fields.event_verification ? { event_verification: fields.event_verification } : {}),
    ...(fields.account_last4 ? { account_last4: fields.account_last4 } : {}),
    ...(fields.account_last4_evidence ? { account_last4_evidence: fields.account_last4_evidence } : {}),
    ...(fields.account_last4_confidence != null ? { account_last4_confidence: fields.account_last4_confidence } : {}),
    ...(fields.target_policy_key ? { target_policy_key: fields.target_policy_key } : {}),
    ...(fields.target_confidence != null ? { target_confidence: fields.target_confidence } : {}),
    ...(fields.target_evidence ? { target_evidence: fields.target_evidence } : {}),
    due_date: fields.due_date,
    ...(typeof fields.currency === "string" ? { currency: fields.currency } : {}),
    type: fields.type,
    category_id: typeof fields.category_code === "string" ? catCodeToId.get(fields.category_code) || null : null,
    category_name: typeof fields.category_name === "string" ? fields.category_name : null,
    to_account_id: typeof fields.to_account_code === "string" ? acctCodeToId.get(fields.to_account_code) || null : null,
  };

  return {
    candidate,
    provider: providerId,
    model,
    metadata: { accounts, categories, payees },
  };
}

export async function extractBill(
  userId: string,
  input: BillExtractionInput,
  dependencies: BillExtractionDependencies = {},
): Promise<BillCandidate & { provider: string; model: string }> {
  const extracted = await extractBillCandidate(userId, input, dependencies);
  return {
    ...extracted.candidate,
    provider: extracted.provider,
    model: extracted.model,
  };
}
