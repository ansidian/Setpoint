import { result, text, type ProviderParser } from "./parser-helpers.ts";

export const EBAY_PARSER_VERSION = "ebay-v1";

/** Only the observed packing template is owned here; other mail keeps AI assessment. */
export const parseEbay: ProviderParser = source => {
  const body = text(source);
  const packing = /^[^\p{L}\p{N}]*Order update:/iu.test(source.subject)
    && /\bthe seller is packing your order!/i.test(body)
    && /\bOrder number:\s*\d{2}-\d{5}-\d{5}\b/i.test(body)
    && /\bEstimated delivery:/i.test(body);
  // A mixed message must retain financial assessment, even if fulfillment
  // wording dominates. Repeated order totals alone do not establish a new charge.
  const financial = /\b(?:refund|charge[ds]?|payment|paid|invoice|amount due|order confirmed|purchase confirmed|order placed|offer accepted)\b/i.test(`${source.subject}\n${body}`);
  return packing && !financial
    ? result("ebay", "packing-update", "nonfinancial", ["fulfillment_notice_no_new_transaction"])
    : result("ebay", "unsupported", "review", ["provider_template_unsupported"]);
};
