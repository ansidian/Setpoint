import { assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const SOFI_PARSER_VERSION = "sofi-v1";

export const parseSofi: ProviderParser = source => {
  if (/payment has been posted|payment is due|banking statement is available/i.test(source.subject)) return result("sofi", "payment-or-banking-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  const body = text(source);
  const scheduled = /credit card autopay is scheduled/i.test(source.subject);
  if (!scheduled && !/SoFi Credit Card \w+ statement is ready/i.test(source.subject)) return unsupported("sofi", source);
  return assessFacts(source, { providerId: "sofi", templateId: scheduled ? "autopay-scheduled" : "card-statement", payee: "SoFi", event: scheduled ? "payment_scheduled" : "statement_issued", type: "transfer", amountKind: scheduled ? "payment_amount" : "statement_balance",
    amounts: scheduled ? moneyMatches(body, "Payment amount", "payment_amount") : [...moneyMatches(body, "statement balance", "statement_balance"), ...moneyMatches(body, "minimum due", "minimum_due")],
    dates: dateMatches(body, scheduled ? "Scheduled payment date" : "payment is due on", source.emailDate),
    // The observed multipart scheduled email includes an contradictory cancellation text part.
    reasons: /(?:cancelled|canceled) autopay/i.test(body) ? ["provider_event_conflict"] : [],
    extra: { account_hint: body.includes("SoFi Unlimited 2% Credit Card") ? "SoFi Unlimited 2% Credit Card" : "SoFi Credit Card", account_hint_confidence: 1 },
  });
};
