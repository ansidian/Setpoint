import { assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const SOCALGAS_PARSER_VERSION = "socalgas-v1";

export const parseSocalgas: ProviderParser = source => {
  if (/payment (?:confirmation|received)|thank you for your payment|payment reminder/i.test(source.subject)) return result("socalgas", "payment-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  if (!/your bill from SoCalGas is now available/i.test(source.subject)) return unsupported("socalgas", source);
  const body = text(source);
  if (/No Payment Required \(Credit Balance\)/i.test(body)) return result("socalgas", "credit-balance", "nonfinancial", ["statement_has_no_payment_obligation"]);
  return assessFacts(source, { providerId: "socalgas", templateId: "bill-ready", payee: "SoCalGas", event: "bill_issued", type: "bill", amountKind: "total_due",
    amounts: moneyMatches(body, "Total Balance", "total_due"), dates: dateMatches(body, "\\bdue", source.emailDate),
  });
};
