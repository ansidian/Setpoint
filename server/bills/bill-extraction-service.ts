import db from "../db/connection.ts";
import type { Client } from "@libsql/client";
import { trimBillBody } from "./bill-extract.ts";
import { ANTHROPIC_PROVIDER } from "./bill-extractors/anthropic.ts";
import { OPENAI_PROVIDER } from "./bill-extractors/openai.ts";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  resolveBillExtractModelConfig,
} from "./bill-extractors/catalog.ts";
import { resolveExtractedBillPay } from "./bill-pay-service.ts";
import { EMPTY_ACTUAL_METADATA, getMetadata } from "../actual/actual-metadata-projection.ts";
import type {
  BillCandidate,
  BillExtractionInput,
  BillExtractionProvider,
  BillPayMappingOutcome,
} from "../../shared/types/bills.ts";

type HttpError = Error & { status?: number };

const PROVIDERS: Record<string, BillExtractionProvider & { id: string; envVar: string }> = {
  [ANTHROPIC_PROVIDER.id]: ANTHROPIC_PROVIDER,
  [OPENAI_PROVIDER.id]: OPENAI_PROVIDER,
};

interface BillExtractionDependencies {
  dbClient?: Pick<Client, "execute">;
  metadataReader?: typeof getMetadata;
  providers?: typeof PROVIDERS;
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

export async function extractBill(
  userId: string,
  { subject, from, body }: BillExtractionInput,
  {
    dbClient = db,
    metadataReader = getMetadata,
    providers = PROVIDERS,
  }: BillExtractionDependencies = {},
): Promise<BillCandidate & { provider: string; model: string; mapping: BillPayMappingOutcome }> {
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
- payee, amount (0 if missing), due_date (YYYY-MM-DD)
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
  const { fields, usage } = await provider.extract({
    model,
    systemPrompt,
    content: trimmed,
  });

  console.log(
    `[EA] Bill extract: provider=${providerId} model=${model} in=${usage.input_tokens ?? usage.prompt_tokens ?? "?"} out=${usage.output_tokens ?? usage.completion_tokens ?? "?"} trimmed_chars=${trimmed.length}`,
  );

  const extracted = {
    payee: fields.payee,
    amount: fields.amount,
    due_date: fields.due_date,
    type: fields.type,
    category_id: typeof fields.category_code === "string" ? catCodeToId.get(fields.category_code) || null : null,
    category_name: typeof fields.category_name === "string" ? fields.category_name : null,
    to_account_id: typeof fields.to_account_code === "string" ? acctCodeToId.get(fields.to_account_code) || null : null,
    provider: providerId,
    model,
  };
  const resolved = await resolveExtractedBillPay(userId, {
    extracted,
    metadata: { accounts, categories, payees },
    email: { subject, from, body },
    dbClient,
  });

  return {
    ...resolved.bill,
    provider: providerId,
    model,
    mapping: resolved.mapping,
  };
}
