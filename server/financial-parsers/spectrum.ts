import { assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const SPECTRUM_PARSER_VERSION = "spectrum-v2";

export const parseSpectrum: ProviderParser = source => {
  const body = text(source);
  if (/^(?:Service Alert|Your Service is Restored)$/i.test(source.subject.trim()) && /outage affecting Spectrum service|your Spectrum service has been restored/i.test(body)
    && !/Amount Due|Statement Amount|Refund (?:total|amount)|Payment Amount/i.test(body)) return result("spectrum", "service-outage", "nonfinancial", ["provider_administrative_notice"]);
  if (/thank you for your payment|your payment is due|payment has been scheduled/i.test(source.subject)) return result("spectrum", "payment-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  if (!/your Spectrum statement is ready/i.test(source.subject)) return unsupported("spectrum", source);
  return assessFacts(source, { providerId: "spectrum", templateId: "statement-ready", payee: "Spectrum", event: "bill_issued", type: "bill", amountKind: "total_due",
    amounts: moneyMatches(body, "Statement Amount", "total_due"), dates: dateMatches(body, "Payment Due", source.emailDate),
  });
};
