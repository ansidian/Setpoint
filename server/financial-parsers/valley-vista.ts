import { assessFacts, dateMatches, referenceEvidence, result, text, unsupported, type ProviderParser } from "./parser-helpers.ts";

export const VALLEY_VISTA_PARSER_VERSION = "valley-vista-v1";

export const parseValleyVista: ProviderParser = source => {
  if (/payment confirmation/i.test(source.subject)) return result("valley-vista", "payment-confirmation", "nonfinancial", ["payment_notice_no_new_obligation"]);
  if (!/Valley Vista Invoice/i.test(source.subject)) return unsupported("valley-vista", source);
  const body = text(source);
  // Extracted PDF tables use pipes and omit dollar signs. The remittance total
  // is the full obligation; Current Invoice Due excludes any carried balance.
  const amounts = [...body.matchAll(/Invoice Total Due:\s*\|\s*(-?[\d,]+\.\d{2})/gi)]
    .map(m => ({ kind: "total_due" as const, value: Number(m[1]!.replace(/,/g, "")), evidence: m[0], confidence: 1 }));
  return assessFacts(source, { providerId: "valley-vista", templateId: "attached-invoice", payee: "Valley Vista Services", event: "bill_issued", type: "bill", amountKind: "total_due",
    amounts, dates: dateMatches(body, "Due Date:\\s*\\|", source.emailDate),
    extra: referenceEvidence(body, /Invoice (?:Number|#)[:\s|]+(\d+)/i),
  });
};
