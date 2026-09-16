import { assessFacts, dateMatches, moneyMatches, referenceEvidence, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const AMAZON_PARSER_VERSION = "amazon-v1";

export const parseAmazon: ProviderParser = source => {
  if (/^(?:Shipped[: ]|Delivered[: ]|Out for delivery:|Delivery update:|Dropoff confirmed|Arriving|Return request confirmed)|return received|return reminder/i.test(source.subject)) return result("amazon", "fulfillment-notice", "nonfinancial", ["fulfillment_notice_no_new_transaction"]);
  if (/Prime Day|Prime members|Enter (?:for a chance |to win)|Introducing:|Sign-in|subscription cancelled|membership (?:renews|change)|discount is coming|printing information/i.test(source.subject)) return result("amazon", "administrative", "nonfinancial", ["provider_administrative_notice"]);
  const body = text(source);
  const order = referenceEvidence(body, /(?:Order\s*#?|order number[:\s]*)\s*(\d{3}-\d{7}-\d{7})/i);
  if (/refund/i.test(source.subject)) return assessFacts(source, {
    providerId: "amazon", templateId: "refund", payee: "Amazon", event: "refund", type: "income", amountKind: "refund_amount",
    amounts: moneyMatches(body, "Refund total|Total refund|Amount refunded", "refund_amount"), dates: dateMatches(body, "Refund date|Date issued", source.emailDate),
    reasons: /estimated|will be issued/i.test(body) ? ["provider_refund_not_issued"] : [], extra: order,
  });
  if (!/^Ordered[: ]|your amazon\.com order|your order #|order confirmation|your digital order/i.test(source.subject)) return unsupported("amazon", source);
  const amounts = moneyMatches(body, "Grand Total|Order Total|Total for this order", "order_total");
  for (const m of body.matchAll(/(?:Grand Total|Order Total):\s*([\d,]+\.\d{2})\s+USD\b/gi)) {
    amounts.push({ kind: "order_total", value: Number(m[1]!.replace(/,/g, "")), confidence: 1, evidence: m[0] });
  }
  const dates = dateMatches(body, "Order date|Ordered on", source.emailDate);
  const assessment = assessFacts(source, { providerId: "amazon", templateId: "order-confirmation", payee: "Amazon", event: "purchase", type: "expense", amountKind: "order_total", amounts, dates,
    reasons: order.provider_reference ? [] : ["provider_order_reference_missing_or_ambiguous"],
    extra: { ...order, document_role: "merchant_receipt", ...(!dates.length ? { purchase_date_context: { kind: "initial_confirmation_without_date", confidence: 1, evidence: source.subject } } : {}) },
  });
  // The event owner derives email-date provenance for initial confirmations, not this pure parser.
  if (assessment.status === "review" && assessment.reasons.every(r => r === "provider_date_missing") && assessment.candidate) return { ...assessment, status: "parsed", candidate: assessment.candidate, reasons: [] };
  return assessment;
};
