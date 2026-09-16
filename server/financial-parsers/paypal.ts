import { assessFacts, DATE, dateMatches, moneyMatches, parseDate, referenceEvidence, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const PAYPAL_PARSER_VERSION = "paypal-v1";

export const parsePaypal: ProviderParser = source => {
  const body = text(source);
  if (/account statement|crypto services are moving|instantly available money/i.test(source.subject)) return result("paypal", "account-notice", "nonfinancial", ["provider_administrative_notice"]);
  if (/receipt for your payment to Synchrony Bank|payment (?:has been|was) (?:posted|received)/i.test(source.subject)) return result("paypal", "card-payment-receipt", "nonfinancial", ["payment_notice_no_new_obligation"]);
  const card = /PayPal Cashback (?:World )?Mastercard/i.test(source.subject);
  if (card) {
    const scheduled = /autopay is coming up soon/i.test(source.subject);
    const refund = /refund or credit has posted/i.test(source.subject);
    if (!scheduled && !refund && !/statement is ready/i.test(source.subject)) return unsupported("paypal", source);
    const product = body.match(/PayPal Cashback (?:World )?Mastercard®?/i)?.[0];
    return assessFacts(source, { providerId: "paypal", templateId: refund ? "synchrony-refund" : scheduled ? "synchrony-autopay" : "synchrony-statement", payee: "PayPal", event: refund ? "refund" : scheduled ? "payment_scheduled" : "statement_issued", type: refund ? "income" : "transfer", amountKind: refund ? "refund_amount" : scheduled ? "payment_amount" : "statement_balance",
      amounts: refund ? moneyMatches(body, "Refund/credit amount", "refund_amount") : scheduled ? moneyMatches(body, "Payment Amount", "payment_amount") : [...moneyMatches(body, "Statement balance", "statement_balance"), ...moneyMatches(body, "Minimum payment due", "minimum_due")],
      dates: dateMatches(body, refund ? "Refund/credit date" : scheduled ? "Payment date" : "Payment due date", source.emailDate),
      extra: product ? { account_hint: product, account_hint_confidence: 1 } : {},
    });
  }
  const reference = referenceEvidence(body, /Transaction ID[:\s]+(?:Transaction date\s+|Date\s+)?((?:O-)?[A-Z0-9]{17,19})\b/i);
  if (/transfer request is processing/i.test(source.subject)) {
    const amount = moneyMatches(body, "Total amount transferred", "transaction_amount");
    const m = body.match(new RegExp(`Transaction ID:\\s*[A-Z0-9]{17,19}\\s+${DATE}`, "i"));
    const date = m ? parseDate(m[1]!, source.emailDate) : null;
    const destination = body.match(/Bank account\s+(.+?)\s+Help & Contact/i)?.[1];
    return assessFacts(source, { providerId: "paypal", templateId: "balance-transfer-pending", payee: "PayPal", event: "account_transfer_pending", type: "transfer", amountKind: "transaction_amount", amounts: amount,
      dates: date && m ? [{ date, evidence: m[0] }] : [], reasons: ["provider_transfer_pending"],
      extra: { ...reference, settlement_kind: "balance_to_bank", settlement_confidence: 1, settlement_evidence: "We're transferring money to your bank", from_account_hint: "PayPal", to_account_hint: destination || null },
    });
  }
  if (/sent you \$[\d,.]+\s*USD/i.test(source.subject)) return assessFacts(source, {
    providerId: "paypal", templateId: "money-received", payee: source.subject.split(/ sent you /i)[0]!, event: "other", type: "income", amountKind: "transaction_amount",
    amounts: moneyMatches(body, "\\bAmount", "transaction_amount"), dates: dateMatches(body, "Transaction date", source.emailDate),
    reasons: ["provider_income_purpose_requires_review"], extra: reference,
  });
  const refund = /you have a refund from|your refund from/i.test(source.subject);
  const authorized = /you have authorized a payment to/i.test(source.subject);
  if (!refund && !authorized && !/you (?:paid|sent)|receipt for your (?:PayPal )?payment|you submitted an order|^.+:\s*\$[\d,.]+\s*(?:USD|CAD|GBP|EUR)/i.test(source.subject)) return unsupported("paypal", source);
  const merchant = refund ? /(?:you have a refund from|your refund from)\s+(.+?)(?: is on the way|$)/i.exec(source.subject)?.[1]
    : /^(.*?):\s*\$[\d,.]+\s*USD/i.exec(source.subject)?.[1]
      || /(?:payment to|USD to)\s+(.+)$/i.exec(source.subject)?.[1]
      || /You (?:paid|sent|authorized a payment of)\s+\$[\d,.]+\s+USD to\s+(.+?)(?:\s+You've|\s+View or Manage|\s+Transaction ID|\s+Transaction Details|\s*\(\s*\))/i.exec(body)?.[1]
      || /Payment to\s+(.+?)\s+[\w.+-]+@[\w.-]+\s+Note to payment recipient/i.exec(body)?.[1]
      || /Payment to\s+Note to payment recipient\s+(.+?)\s+You haven't included a note/i.exec(body)?.[1];
  const dates = dateMatches(body, "Transaction date|(?<=Transaction ID [A-Z0-9]{17}) Date", source.emailDate);
  if (!dates.length) {
    const m = body.match(new RegExp(`Transaction ID\\s+(?:Transaction date|Date)\\s+[A-Z0-9]{17,19}\\s+(?:\\(\\s*\\)\\s*)?${DATE}`, "i"));
    const date = m ? parseDate(m[1]!, source.emailDate) : null;
    if (m && date) dates.push({ date, evidence: m[0] });
  }
  return assessFacts(source, { providerId: "paypal", templateId: refund ? "merchant-refund" : authorized ? "merchant-authorization" : "merchant-receipt", payee: merchant || "PayPal", event: refund ? "refund" : "purchase", type: refund ? "income" : "expense", amountKind: refund ? "refund_amount" : "transaction_amount",
    amounts: moneyMatches(body, refund ? "Amount refunded|Refund total" : "\\bTotal(?: amount of this Transaction)?|Money sent", refund ? "refund_amount" : "transaction_amount"), dates,
    reasons: [...(!merchant ? ["provider_merchant_missing"] : []), ...(authorized ? ["provider_payment_authorization_pending"] : []), ...(/refund.*on the way/i.test(source.subject) ? ["provider_refund_not_issued"] : [])],
    extra: { ...reference, document_role: "processor_receipt" },
  });
};
