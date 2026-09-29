import { accountEvidence, assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const SOFI_PARSER_VERSION = "sofi-v3";

export const parseSofi: ProviderParser = source => {
  if (/payment has been posted|payment is due|banking statement is available/i.test(source.subject)) return result("sofi", "payment-or-banking-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  const body = text(source);
  const received = source.subject.match(/^Notification - (.+?) sent you \$([\d,]+\.\d{2})\.?$/i);
  const sent = source.subject.match(/^Notification - Your\s+\$([\d,]+\.\d{2}) to (.+?) was sent\.?$/i);
  if (received || sent) {
    // Zelle alerts carry no transaction date or per-transfer reference (ReferenceID
    // is account-level), so the owner chooses the date, payee and purpose.
    const counterparty = (received ? received[1] : sent![2])!.trim();
    const subjectAmount = (received ? received[2] : sent![1])!;
    const confirmation = body.match(received ? /The \$([\d,]+\.\d{2}) sent to you by/i : /You['’]ve successfully sent \$([\d,]+\.\d{2}) to/i);
    // Subject and body must agree; a disagreement stays an amount conflict.
    const amounts = confirmation ? [subjectAmount, confirmation[1]!].map((value, index) => ({ kind: "transaction_amount" as const,
      value: Number(value.replace(/,/g, "")), evidence: index ? confirmation[0] : source.subject, confidence: 1 })) : [];
    return assessFacts(source, { providerId: "sofi", templateId: received ? "zelle-received" : "zelle-sent", payee: counterparty,
      event: "other", type: received ? "income" : "expense", amountKind: "transaction_amount", amounts, dates: [],
      reasons: [received ? "provider_income_purpose_requires_review" : "provider_payment_purpose_requires_review"] });
  }
  const scheduled = /credit card autopay is scheduled/i.test(source.subject);
  if (!scheduled && !/SoFi Credit Card \w+ statement is ready/i.test(source.subject)) return unsupported("sofi", source);
  return assessFacts(source, { providerId: "sofi", templateId: scheduled ? "autopay-scheduled" : "card-statement", payee: "SoFi", event: scheduled ? "payment_scheduled" : "statement_issued", type: "transfer", amountKind: scheduled ? "payment_amount" : "statement_balance",
    amounts: scheduled ? moneyMatches(body, "Payment amount", "payment_amount") : [...moneyMatches(body, "statement balance", "statement_balance"), ...moneyMatches(body, "minimum due", "minimum_due")],
    dates: dateMatches(body, scheduled ? "Scheduled payment date" : "payment is due on", source.emailDate),
    // The observed multipart scheduled email includes an contradictory cancellation text part.
    reasons: /(?:cancelled|canceled) autopay/i.test(body) ? ["provider_event_conflict"] : [],
    extra: { ...accountEvidence(body, /\b(?:credit\s+)?card\s+ending(?:\s+in)?\s*[:*x•.]*\s*(\d{4})\b/i),
      account_hint: body.includes("SoFi Unlimited 2% Credit Card") ? "SoFi Unlimited 2% Credit Card" : "SoFi Credit Card", account_hint_confidence: 1 },
  });
};
