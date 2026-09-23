import { assessFacts, dateMatches, moneyMatches, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const SCE_PARSER_VERSION = "sce-v2";

export const parseSce: ProviderParser = source => {
  const body = text(source);
  if (/^Did You Know You Have Rate Plan Options\?$/i.test(source.subject.trim()) && /comparison chart.*for information only/i.test(body)
    && !/Amount Due|Statement Amount|Refund (?:total|amount)|Payment Amount/i.test(body)) return result("sce", "rate-comparison", "nonfinancial", ["provider_administrative_notice"]);
  if (/payment reminder|thank you for your payment/i.test(source.subject)) return result("sce", "payment-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  if (!/^bill is ready$/i.test(source.subject.trim())) return unsupported("sce", source);
  const statement = dateMatches(body, "Statement Date", source.emailDate)[0];
  return assessFacts(source, { providerId: "sce", templateId: "bill-ready", payee: "SCE", event: "bill_issued", type: "bill", amountKind: "total_due",
    amounts: moneyMatches(body, "Amount Due", "total_due"), dates: dateMatches(body, "Due Date", source.emailDate),
    extra: statement ? { statement_facts: { statement_date: statement.date, statement_date_evidence: statement.evidence, no_payment_required: null, no_payment_evidence: null, account_credit: null, account_credit_evidence: null, new_charges: null, new_charges_evidence: null, carried_balance: null, carried_balance_evidence: null } } : {},
  });
};
