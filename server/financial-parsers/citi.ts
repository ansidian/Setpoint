import { accountEvidence, assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const CITI_PARSER_VERSION = "citi-v1";

export const parseCiti: ProviderParser = source => {
  if (/payment due date is approaching|upcoming AutoPay payment reminder|payment (?:received|complete)/i.test(source.subject)) return result("citi", "payment-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  const body = text(source);
  const account = accountEvidence(body, /Card ending in\s+(\d{4})/i);
  if (/transaction was made on your/i.test(source.subject)) {
    // Only the labeled transaction amount is operational. The custom alert threshold is not money spent.
    const merchant = /\bMerchant\s+(.+?)\s+Date\s+\d/i.exec(body)?.[1];
    return assessFacts(source, { providerId: "citi", templateId: "transaction-alert", payee: merchant || "Citi", event: "purchase", type: "expense", amountKind: "transaction_amount",
      amounts: moneyMatches(body, "\\bAmount", "transaction_amount"), dates: dateMatches(body, "\\bDate", source.emailDate),
      reasons: merchant ? [] : ["provider_merchant_missing"], extra: { ...account, document_role: "bank_notification" },
    });
  }
  if (!/statement is now available online/i.test(source.subject)) return unsupported("citi", source);
  const product = /Costco Anywhere Visa\s*®?/.exec(body)?.[0];
  return assessFacts(source, { providerId: "citi", templateId: "card-statement", payee: "Citi", event: "statement_issued", type: "transfer", amountKind: "statement_balance",
    amounts: [...moneyMatches(body, "Statement Balance", "statement_balance"), ...moneyMatches(body, "Minimum Payment Due", "minimum_due")],
    dates: dateMatches(body, "Payment Due Date", source.emailDate), reasons: product ? [] : ["provider_card_product_unsupported"], extra: { ...account, ...(product ? { account_hint: product, account_hint_confidence: 1 } : {}) },
  });
};
