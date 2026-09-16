import type { BillAmountCandidate, BillAmountKind, BillCandidate, BillEventKind } from "../../shared/types/bills.ts";
import type { FinancialProviderEmailSource, FinancialProviderId, RecognizedFinancialProviderAssessment } from "../../shared/types/financial-parsers.ts";

export type ProviderParser = (source: FinancialProviderEmailSource) => RecognizedFinancialProviderAssessment;
export const NORMALIZATION_VERSION = "provider-text-v1";
export const MONEY = String.raw`\$\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?![\d.])`;
export const DATE = String.raw`((?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:\d{1,2}/\d{1,2}(?:/\d{2,4})?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}))`;

/** Remove transport decoration without collapsing table columns into inferred facts. */
export function text(source: FinancialProviderEmailSource): string {
  return [source.body, ...(source.attachments || []).map(a => a.text)].join("\n")
    .replace(/https?:\/\/[^\s)]+/g, " ")
    .replace(/\[Image omitted[^\]]*\]/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0]?.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(/&(?:nbsp|thinsp);/gi, " ").replace(/&(?:rsquo|lsquo|apos);/gi, "'")
    .replace(/&(?:rdquo|ldquo|quot);/gi, '"').replace(/&amp;/gi, "&")
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, "").replace(/\u034f/g, "").replace(/\s+/g, " ").trim();
}

export function result(providerId: FinancialProviderId, templateId: string, status: "review" | "nonfinancial", reasons: string[], candidate?: BillCandidate): RecognizedFinancialProviderAssessment {
  const base = { providerId, parserVersion: `${providerId}-v1`, templateId, reasons };
  return status === "nonfinancial" ? { ...base, status } : { ...base, status, ...(candidate ? { candidate } : {}) };
}

export function unsupported(providerId: FinancialProviderId, source: FinancialProviderEmailSource): RecognizedFinancialProviderAssessment {
  // Only explicit known administrative/marketing families are negative assessments.
  const known = /(?:terms|agreement|privacy|security alert|passkey|verification|update your income|credit summary|fico score|pre.?approved|pre.?qualified|offer|invitation|survey|feedback|climate credit|participation hearing|safety inspection|communication preference|account statement is available|banking statement|APY|stay logged in|expired card|update your card|legal agreements)/i;
  return known.test(source.subject)
    ? result(providerId, "administrative", "nonfinancial", ["provider_administrative_notice"])
    : result(providerId, "unsupported", "review", ["provider_template_unsupported"]);
}

export function moneyMatches(body: string, label: string, kind: BillAmountKind): BillAmountCandidate[] {
  return [...body.matchAll(new RegExp(`(?:${label})[:\\s*]*(?:is[:\\s]*)?${MONEY}`, "gi"))]
    .map(m => ({ kind, value: Number(m[1]!.replace(/,/g, "")), evidence: m[0], confidence: 1 }));
}

export function parseDate(raw: string, emailDate?: string | null): string | null {
  const cleaned = raw.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/i, "");
  let year: number; let month: number; let day: number;
  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(cleaned);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (numeric) {
    month = Number(numeric[1]); day = Number(numeric[2]);
    if (!numeric[3]) {
      if (!emailDate || !Number.isFinite(Date.parse(emailDate))) return null;
      const received = new Date(emailDate);
      // Yearless SoFi due dates must fall within the current bill's 62-day horizon.
      const possible = [received.getUTCFullYear() - 1, received.getUTCFullYear(), received.getUTCFullYear() + 1]
        .map(y => Date.UTC(y, month - 1, day)).filter(t => t >= received.getTime() - 86400000 && t <= received.getTime() + 62 * 86400000);
      if (possible.length !== 1) return null;
      year = new Date(possible[0]!).getUTCFullYear();
    } else year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
  } else if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else {
    const m = /^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(cleaned);
    if (!m) return null;
    month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
    day = Number(m[2]); year = Number(m[3]);
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
}

export function dateMatches(body: string, label: string, emailDate?: string | null): Array<{ date: string; evidence: string }> {
  return [...body.matchAll(new RegExp(`(?:${label})[:\\s*]+${DATE}`, "gi"))]
    .flatMap(m => { const date = parseDate(m[1]!, emailDate); return date ? [{ date, evidence: m[0] }] : []; });
}

export interface TemplateFacts {
  providerId: FinancialProviderId;
  templateId: string;
  payee: string;
  event: BillEventKind;
  type: "bill" | "transfer" | "expense" | "income";
  amountKind: BillAmountKind;
  amounts: BillAmountCandidate[];
  dates: Array<{ date: string; evidence: string }>;
  extra?: BillCandidate;
  reasons?: string[];
}

/** Shared completeness/conflict checks; company modules choose labels and template semantics. */
export function assessFacts(source: FinancialProviderEmailSource, facts: TemplateFacts): RecognizedFinancialProviderAssessment {
  const operational = [...new Set(facts.amounts.filter(a => a.kind === facts.amountKind).map(a => a.value))];
  const dates = [...new Set(facts.dates.map(d => d.date))];
  const reasons = [...(facts.reasons || [])];
  if (facts.extra?.account_last4_confidence === 0) reasons.push("provider_account_conflict");
  if (operational.length !== 1) reasons.push(operational.length ? "provider_amount_conflict" : "provider_amount_missing");
  if (dates.length !== 1) reasons.push(dates.length ? "provider_date_conflict" : "provider_date_missing");
  if (operational.some(v => !Number.isFinite(v) || v < 0)) reasons.push("provider_amount_invalid");
  const body = text(source);
  if (/\b(?:CAD|AUD|EUR|GBP|JPY)\b|[€£¥]/.test(body)) reasons.push("provider_currency_unsupported");
  const evidence = source.subject;
  const candidate: BillCandidate = {
    payee: facts.payee, payee_hint: facts.payee, currency: "USD", type: facts.type,
    type_confidence: 1, type_evidence: evidence, event_kind: facts.event,
    event_confidence: 1, event_evidence: evidence,
    document_role: facts.event === "statement_issued" || facts.event === "bill_issued" ? "statement" : "bank_notification",
    amount: operational.length === 1 ? operational[0] : null, amount_kind: facts.amountKind,
    amount_candidates: facts.amounts, due_date: dates.length === 1 ? dates[0] : null,
    ...facts.extra,
  };
  const base = { providerId: facts.providerId, parserVersion: `${facts.providerId}-v1`, templateId: facts.templateId, reasons, candidate };
  return reasons.length ? { ...base, status: "review" } : { ...base, status: "parsed" };
}

export function accountEvidence(body: string, pattern: RegExp): BillCandidate {
  const matches = [...body.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  const suffixes = [...new Set(matches.map(m => m[1]))];
  if (suffixes.length > 1) return { account_last4: null, account_last4_confidence: 0, account_last4_evidence: matches.map(m => m[0]).join("; ") };
  if (suffixes.length !== 1) return {};
  return { account_last4: suffixes[0], account_last4_evidence: matches[0]![0], account_last4_confidence: 1 };
}

export function referenceEvidence(body: string, pattern: RegExp): BillCandidate {
  const matches = [...body.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  const refs = [...new Set(matches.map(m => m[1]))];
  return refs.length === 1 ? { provider_reference: refs[0], provider_reference_evidence: matches[0]![0], provider_reference_confidence: 1 } : {};
}
