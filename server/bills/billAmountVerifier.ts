import type {
  BillAmountCandidate,
  BillCandidate,
  BillExtractionProvider,
  BillAmountVerification,
} from "../../shared/types/bills.ts";
import { hasAmbiguousSemanticBillAmount, selectSemanticBillAmount } from "./billSemanticAmountPolicy.ts";

const MIN_VERIFY_VALUES = 1;
const MAX_VERIFY_VALUES = 8;

export interface BillAmountVerificationResult {
  candidate: BillCandidate;
  usage: Record<string, unknown>;
}

function moneyNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function amountKey(value: unknown): string | null {
  const parsed = moneyNumber(value);
  return parsed == null ? null : parsed.toFixed(2);
}

export function currencyValuesInText(content: string): number[] {
  const values = new Map<string, number>();
  const pattern = /(?:\$|US\$|USD\s*)\s*([0-9][0-9,]*(?:\.\d{1,2})?)|([0-9][0-9,]*(?:\.\d{1,2})?)\s*USD\b/gi;
  for (const match of content.matchAll(pattern)) {
    const value = moneyNumber(match[1] || match[2]);
    const key = amountKey(value);
    if (value != null && key) values.set(key, value);
  }
  return [...values.values()];
}

function candidateValues(candidate: BillCandidate): Set<string> {
  const keys = new Set<string>();
  for (const item of candidate.amount_candidates || []) {
    const key = amountKey(item.value);
    if (key) keys.add(key);
  }
  return keys;
}

export function coveredCurrencyValueCount(sourceValues: number[], candidate: BillCandidate): number {
  const extracted = candidateValues(candidate);
  return sourceValues.reduce((count, value) => count + Number(extracted.has(amountKey(value)!)), 0);
}

function selectedCandidate(candidate: BillCandidate): BillAmountCandidate | null {
  const selectedAmount = amountKey(candidate.amount);
  if (!candidate.amount_kind || !selectedAmount) return null;
  return (candidate.amount_candidates || []).find((item) => (
    item.kind === candidate.amount_kind && amountKey(item.value) === selectedAmount
  )) || null;
}

function withoutMinimumDueSelection(candidate: BillCandidate): BillCandidate {
  if (candidate.amount_kind !== "minimum_due") return candidate;
  return { ...candidate, amount: null, amount_kind: null };
}

function selectionIsValid(candidate: BillCandidate): boolean {
  const unverified = { ...candidate, amount_verification: undefined };
  if (hasAmbiguousSemanticBillAmount(unverified)) return false;
  const canonical = selectSemanticBillAmount(unverified);
  if (!canonical) return candidate.amount == null && candidate.amount_kind == null;
  const selected = selectedCandidate(candidate);
  return Boolean(selected && selected.kind === canonical.kind
    && amountKey(selected.value) === amountKey(canonical.amount));
}

function repairSelectionFromSemanticCandidates(candidate: BillCandidate): BillCandidate | null {
  const selected = selectSemanticBillAmount({ ...candidate, amount: null, amount_verification: undefined });
  const repaired = { ...candidate, amount: selected?.amount ?? null, amount_kind: selected?.kind ?? null };
  return selectionIsValid(repaired) ? repaired : null;
}

function hasGroundedAmountEvidence(content: string, candidate: BillCandidate): boolean {
  const source = content.replace(/\s+/g, " ").trim();
  return (candidate.amount_candidates || []).every((item) => {
    const evidence = String(item.evidence || "").replace(/\s+/g, " ").trim();
    return evidence.length > 0
      && evidence.length <= 320
      && source.includes(evidence)
      && currencyValuesInText(evidence).some((value) => amountKey(value) === amountKey(item.value));
  });
}

function hasConflictingStatementBalances(candidate: BillCandidate): boolean {
  return new Set((candidate.amount_candidates || [])
    .filter((item) => item.kind === "statement_balance")
    .map((item) => amountKey(item.value))).size > 1;
}

function amountEvidenceNeedsAudit(content: string, candidate: BillCandidate): boolean {
  return !hasGroundedAmountEvidence(content, candidate) || hasConflictingStatementBalances(candidate)
    || hasAmbiguousSemanticBillAmount({ ...candidate, amount_verification: undefined });
}

export function shouldVerifyBillAmounts(content: string, candidate: BillCandidate): boolean {
  const sourceValues = currencyValuesInText(content);
  if (sourceValues.length < MIN_VERIFY_VALUES || sourceValues.length > MAX_VERIFY_VALUES) return false;
  return coveredCurrencyValueCount(sourceValues, candidate) < sourceValues.length
    || !selectionIsValid(candidate)
    || (sourceValues.length > 1 && amountEvidenceNeedsAudit(content, candidate));
}

function verificationMetadata(
  status: BillAmountVerification["status"],
  sourceValueCount: number,
  initialCoveredCount: number,
  provider: string,
  model: string,
  verifiedCoveredCount?: number,
): BillAmountVerification {
  return {
    status,
    source_value_count: sourceValueCount,
    initial_covered_count: initialCoveredCount,
    ...(verifiedCoveredCount == null ? {} : { verified_covered_count: verifiedCoveredCount }),
    provider,
    model,
  };
}

export async function verifyBillAmounts({
  content,
  candidate,
  provider,
  providerId,
  model,
}: {
  content: string;
  candidate: BillCandidate;
  provider: BillExtractionProvider;
  providerId: string;
  model: string;
}): Promise<BillAmountVerificationResult> {
  const canonicalCandidate = withoutMinimumDueSelection(candidate);
  const removedMinimumSelection = canonicalCandidate !== candidate;
  const sourceValues = currencyValuesInText(content);
  const initialCovered = coveredCurrencyValueCount(sourceValues, canonicalCandidate);
  if (!shouldVerifyBillAmounts(content, canonicalCandidate)) {
    return {
      candidate: removedMinimumSelection
        ? {
            ...canonicalCandidate,
            amount_verification: verificationMetadata(
              "corrected",
              sourceValues.length,
              initialCovered,
              providerId,
              model,
              initialCovered,
            ),
          }
        : canonicalCandidate,
      usage: {},
    };
  }
  const needsEvidenceAudit = sourceValues.length > 1 && amountEvidenceNeedsAudit(content, canonicalCandidate);
  if (initialCovered === sourceValues.length && !selectionIsValid(canonicalCandidate) && !needsEvidenceAudit) {
    const repaired = repairSelectionFromSemanticCandidates(canonicalCandidate);
    if (repaired) {
      return {
        candidate: {
          ...repaired,
          amount_verification: verificationMetadata(
            "corrected",
            sourceValues.length,
            initialCovered,
            providerId,
            model,
            initialCovered,
          ),
        },
        usage: {},
      };
    }
  }

  const prompt = `Audit a first-pass bill amount extraction against the original email evidence.

Return a corrected extraction using the required schema. Focus on amount, amount_kind, and amount_candidates:
- Account for every distinct numeric currency value visible in the source, up to the schema limit.
- Audit each semantic label as well as each numeric value. Complete numeric coverage does not establish correct label/value associations.
- Preserve source rows and table relationships. When several labels precede several values, use explicit structural or repeated source evidence to resolve their association; do not guess from proximity.
- For each amount_candidate, copy one short contiguous verbatim evidence excerpt (at most 320 characters) containing its currency value and supporting label. Do not paraphrase, add ellipses, or join separate source excerpts. An informational zero balance is not a statement balance unless the source explicitly labels it as such.
- When several amounts share the same role, select one only if original labels, dates, or account relationships identify it as the relevant amount. Confidence does not distinguish two payments. If the source cannot resolve the conflict, preserve the candidates and return null amount and null amount_kind.
- Keep minimum_due separate from statement_balance and total_due.
- Select the canonical amount for the first-pass event. For scheduled or completed payments/transfers, an explicit payment_amount takes precedence over a statement_balance. Statement balance is canonical for statements and repayment obligations; a completed transaction must not borrow an informational statement balance as its paid amount. Preserve minimum_due only as an informational candidate and never select it. If no non-minimum canonical amount exists, return null amount and null amount_kind.
- Use null amount and null amount_kind when values are informational, promotional, projected, or otherwise not payable.
- Do not invent values or infer a numeric amount from phrases such as "full statement balance."

First-pass extraction:
${JSON.stringify({
    event_kind: canonicalCandidate.event_kind ?? null,
    amount: canonicalCandidate.amount ?? null,
    amount_kind: canonicalCandidate.amount_kind ?? null,
    amount_candidates: canonicalCandidate.amount_candidates || [],
  })}`;

  try {
    const verified = await provider.extract({ model, systemPrompt: prompt, content, usagePurpose: "verification" });
    const verifiedCandidate = withoutMinimumDueSelection({ ...verified.fields, event_kind: canonicalCandidate.event_kind });
    const verifiedCovered = coveredCurrencyValueCount(sourceValues, verifiedCandidate);
    const accepted = verifiedCovered === sourceValues.length
      && selectionIsValid(verifiedCandidate)
      && !amountEvidenceNeedsAudit(content, verifiedCandidate);
    if (!accepted) {
      return {
        candidate: {
          ...canonicalCandidate,
          amount_verification: verificationMetadata(
            needsEvidenceAudit || initialCovered < sourceValues.length || !selectionIsValid(canonicalCandidate)
              ? "failed"
              : "kept_initial",
            sourceValues.length,
            initialCovered,
            providerId,
            model,
            verifiedCovered,
          ),
        },
        usage: verified.usage || {},
      };
    }
    return {
      candidate: {
        ...canonicalCandidate,
        amount: verifiedCandidate.amount ?? null,
        amount_kind: verifiedCandidate.amount_kind ?? null,
        amount_candidates: verifiedCandidate.amount_candidates || [],
        amount_verification: verificationMetadata(
          "corrected",
          sourceValues.length,
          initialCovered,
          providerId,
          model,
          verifiedCovered,
        ),
      },
      usage: verified.usage || {},
    };
  } catch {
    return {
      candidate: {
        ...canonicalCandidate,
        amount_verification: verificationMetadata(
          "failed",
          sourceValues.length,
          initialCovered,
          providerId,
          model,
        ),
      },
      usage: {},
    };
  }
}
