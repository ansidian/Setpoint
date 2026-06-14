import db from "../db/connection.js";
import { trimBillBody } from "./bill-extract.js";
import { ANTHROPIC_PROVIDER } from "./bill-extractors/anthropic.js";
import { OPENAI_PROVIDER } from "./bill-extractors/openai.js";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  isAllowedBillExtractModel,
} from "./bill-extractors/catalog.js";
import { resolveExtractedBillPay } from "./bill-pay-service.js";
import { EMPTY_ACTUAL_METADATA, getMetadata } from "../actual/actual-metadata-projection.js";

const PROVIDERS = {
  [ANTHROPIC_PROVIDER.id]: ANTHROPIC_PROVIDER,
  [OPENAI_PROVIDER.id]: OPENAI_PROVIDER,
};

export async function loadBillExtractChoice(userId) {
  try {
    const result = await db.execute({
      sql: "SELECT bill_extract_provider, bill_extract_model FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    const row = result.rows?.[0] || {};
    let provider = row.bill_extract_provider || DEFAULT_BILL_EXTRACT_PROVIDER;
    let model = row.bill_extract_model || DEFAULT_BILL_EXTRACT_MODEL;
    if (!isAllowedBillExtractModel(provider, model)) {
      provider = DEFAULT_BILL_EXTRACT_PROVIDER;
      model = DEFAULT_BILL_EXTRACT_MODEL;
    }
    return { provider, model };
  } catch {
    return { provider: DEFAULT_BILL_EXTRACT_PROVIDER, model: DEFAULT_BILL_EXTRACT_MODEL };
  }
}

export async function extractBill(userId, { subject, from, body }) {
  const metadata = await getMetadata(userId).catch(() => EMPTY_ACTUAL_METADATA);
  const categories = metadata.categories || [];
  const accounts = metadata.accounts || [];
  const payees = metadata.payees || [];

  const catCodeToId = new Map();
  const catList = [];
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
  const acctCodeToId = new Map();
  const acctList = [];
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

  const { provider: providerId, model } = await loadBillExtractChoice(userId);
  const provider = PROVIDERS[providerId];
  if (!provider) {
    const err = new Error(`Unknown bill-extract provider: ${providerId}`);
    err.status = 400;
    throw err;
  }
  if (!process.env[provider.envVar]) {
    const err = new Error(`Bill extract unavailable: ${provider.envVar} not set`);
    err.status = 503;
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
    category_id: fields.category_code ? catCodeToId.get(fields.category_code) || null : null,
    category_name: fields.category_name || null,
    to_account_id: fields.to_account_code ? acctCodeToId.get(fields.to_account_code) || null : null,
    provider: providerId,
    model,
  };
  const resolved = await resolveExtractedBillPay(userId, {
    extracted,
    metadata: { accounts, categories, payees },
    email: { subject, from, body },
  });

  return {
    ...resolved.bill,
    provider: providerId,
    model,
    mapping: resolved.mapping,
  };
}
