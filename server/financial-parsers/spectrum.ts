import { assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const SPECTRUM_PARSER_VERSION = "spectrum-v1";

export const parseSpectrum: ProviderParser = source => {
  if (/thank you for your payment|your payment is due|payment has been scheduled/i.test(source.subject)) return result("spectrum", "payment-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  if (!/your Spectrum statement is ready/i.test(source.subject)) return unsupported("spectrum", source);
  const body = text(source);
  return assessFacts(source, { providerId: "spectrum", templateId: "statement-ready", payee: "Spectrum", event: "bill_issued", type: "bill", amountKind: "total_due",
    amounts: moneyMatches(body, "Statement Amount", "total_due"), dates: dateMatches(body, "Payment Due", source.emailDate),
  });
};
