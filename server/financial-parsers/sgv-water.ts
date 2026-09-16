import { assessFacts, dateMatches, moneyMatches, referenceEvidence, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const SGV_WATER_PARSER_VERSION = "sgv-water-v1";

export const parseSgvWater: ProviderParser = source => {
  if (/payment confirmation/i.test(source.subject)) return result("sgv-water", "payment-confirmation", "nonfinancial", ["payment_notice_no_new_obligation"]);
  if (!/San Gabriel Valley Water Company Invoice#\s*\d+ Notification/i.test(source.subject)) return unsupported("sgv-water", source);
  const body = text(source);
  // The original two-column InvoiceCloud text interleaves explanatory copy before the dollar value.
  const amounts = moneyMatches(body, "Balance Due", "total_due");
  if (!amounts.length) {
    const m = /Balance Due:\s*(?:If you have any questions regarding your account, please contact us at \(626\) 774-2789 or email us at\s*)\$\s*([\d,]+\.\d{2})/i.exec(body);
    if (m) amounts.push({ kind: "total_due", value: Number(m[1]!.replace(/,/g, "")), evidence: m[0], confidence: 1 });
  }
  return assessFacts(source, { providerId: "sgv-water", templateId: "invoicecloud-invoice", payee: "San Gabriel Valley Water Company", event: "bill_issued", type: "bill", amountKind: "total_due", amounts,
    dates: dateMatches(body, "Invoice Due Date", source.emailDate), extra: referenceEvidence(source.subject, /Invoice#\s*(\d+)/i),
  });
};
