import { accountEvidence, assessFacts, dateMatches, moneyMatches, referenceEvidence, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const CHASE_PARSER_VERSION = "chase-v1";

export const parseChase: ProviderParser = source => {
  if (/payment (?:received|complete|reminder)|payment is due/i.test(source.subject)) return result("chase", "payment-notice", "nonfinancial", ["payment_notice_no_new_obligation"]);
  const body = text(source);
  const account = accountEvidence(body, /(?:Chase Credit Card\s*\(\.\.\.|Account\s*\.\.\.)(\d{4})/i);
  if (/cash back is on the way/i.test(source.subject)) {
    const statementCredits = moneyMatches(body, "Statement credit", "transaction_amount");
    return assessFacts(source, {
    providerId: "chase", templateId: "cashback-request", payee: "Chase", event: "reward", type: "income", amountKind: "transaction_amount",
    amounts: [...moneyMatches(body, "Cash amount", "transaction_amount"), ...statementCredits], dates: dateMatches(body, "Order date", source.emailDate),
    reasons: statementCredits.length ? ["provider_reward_pending"] : ["provider_reward_settlement_unspecified"],
    extra: { ...account, ...referenceEvidence(body, /Order number\s+([A-Z0-9-]+)/i), ...(statementCredits.length ? { settlement_kind: "statement_credit", settlement_confidence: 1, settlement_evidence: statementCredits[0]!.evidence } : {}) },
  });
  }
  if (!/your credit card statement is available/i.test(source.subject)) return unsupported("chase", source);
  return assessFacts(source, { providerId: "chase", templateId: "card-statement", payee: "Chase", event: "statement_issued", type: "transfer", amountKind: "statement_balance",
    amounts: [...moneyMatches(body, "Statement balance", "statement_balance"), ...moneyMatches(body, "Minimum payment due", "minimum_due")],
    dates: dateMatches(body, "Due date", source.emailDate), extra: account,
  });
};
