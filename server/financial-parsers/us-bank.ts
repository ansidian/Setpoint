import { accountEvidence, assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const US_BANK_PARSER_VERSION = "us-bank-v1";

export const parseUsBank: ProviderParser = source => {
  if (/payment is complete|payment is due/i.test(source.subject)) return result("us-bank", "payment-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  if (!/latest credit card statement is ready/i.test(source.subject)) return unsupported("us-bank", source);
  const body = text(source);
  return assessFacts(source, { providerId: "us-bank", templateId: "card-statement", payee: "U.S. Bank", event: "statement_issued", type: "transfer", amountKind: "statement_balance",
    amounts: [...moneyMatches(body, "Remaining statement balance", "statement_balance"), ...moneyMatches(body, "Minimum payment", "minimum_due")],
    dates: dateMatches(body, "Due date", source.emailDate), extra: accountEvidence(body, /credit card ending in\s+(\d{4})/i),
  });
};
