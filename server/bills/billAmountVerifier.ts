import type {
  BillAmountCandidate,
  BillCandidate,
  BillExtractionProvider,
  BillAmountVerification,
} from "../../shared/types/bills.ts";

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
  const hasStatementBalance = (candidate.amount_candidates || []).some((item) => item.kind === "statement_balance");
  if (candidate.amount == null && candidate.amount_kind == null) {
    return !(candidate.amount_candidates || []).some((item) => [
      "statement_balance",
      "total_due",
      "payment_amount",
      "transaction_amount",
      "refund_amount",
      "order_total",
    ].includes(item.kind));
  }
  const selected = selectedCandidate(candidate);
  if (!selected) return false;
  if (hasStatementBalance) return candidate.amount_kind === "statement_balance";
  return candidate.amount_kind !== "minimum_due";
}

function repairSelectionFromSemanticCandidates(candidate: BillCandidate): BillCandidate | null {
  const candidates = candidate.amount_candidates || [];
  const statementBalance = candidates
    .filter((entry) => entry.kind === "statement_balance")
    .sort((left, right) => Number(right.confidence ?? -1) - Number(left.confidence ?? -1))[0];
  if (statementBalance) {
    return { ...candidate, amount: statementBalance.value, amount_kind: "statement_balance" };
  }
  const selectedAmount = amountKey(candidate.amount);
  if (selectedAmount) {
    for (const item of candidates.filter((entry) => amountKey(entry.value) === selectedAmount)) {
      const repaired = { ...candidate, amount: item.value, amount_kind: item.kind };
      if (selectionIsValid(repaired)) return repaired;
    }
  }
  const preferencesByEvent: Record<string, BillAmountCandidate["kind"][]> = {
    statement_issued: ["statement_balance", "total_due"],
    payment_due: ["statement_balance", "total_due", "payment_amount"],
    payment_scheduled: ["statement_balance", "total_due", "payment_amount"],
    card_payment_completed: ["payment_amount"],
    payment_completed: ["payment_amount", "total_due"],
    purchase: ["transaction_amount", "order_total", "total_due"],
    refund: ["refund_amount"],
    bill_issued: ["total_due", "statement_balance"],
  };
  const preferences = preferencesByEvent[String(candidate.event_kind || "")] || [
    "statement_balance",
    "total_due",
    "payment_amount",
    "transaction_amount",
    "refund_amount",
    "order_total",
  ];
  for (const kind of preferences) {
    const item = candidates.find((entry) => entry.kind === kind);
    if (!item) continue;
    const repaired = { ...candidate, amount: item.value, amount_kind: item.kind };
    if (selectionIsValid(repaired)) return repaired;
  }
  return null;
}

export function shouldVerifyBillAmounts(content: string, candidate: BillCandidate): boolean {
  const sourceValues = currencyValuesInText(content);
  if (sourceValues.length < MIN_VERIFY_VALUES || sourceValues.length > MAX_VERIFY_VALUES) return false;
  return coveredCurrencyValueCount(sourceValues, candidate) < sourceValues.length
    || !selectionIsValid(candidate);
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
  if (initialCovered === sourceValues.length && !selectionIsValid(canonicalCandidate)) {
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
- Associate labels with values on nearby following lines, including layouts where several labels precede several values.
- Keep minimum_due separate from statement_balance and total_due.
- Select the canonical amount actually charged, paid, refunded, or billed. A statement balance is canonical whenever present. Preserve minimum_due only as an informational candidate and never select it. If no non-minimum canonical amount exists, return null amount and null amount_kind.
- Use null amount and null amount_kind when values are informational, promotional, projected, or otherwise not payable.
- Do not invent values or infer a numeric amount from phrases such as "full statement balance."

First-pass extraction:
${JSON.stringify({
    amount: canonicalCandidate.amount ?? null,
    amount_kind: canonicalCandidate.amount_kind ?? null,
    amount_candidates: canonicalCandidate.amount_candidates || [],
  })}`;

  try {
    const verified = await provider.extract({ model, systemPrompt: prompt, content, usagePurpose: "verification" });
    const verifiedCandidate = withoutMinimumDueSelection(verified.fields);
    const verifiedCovered = coveredCurrencyValueCount(sourceValues, verifiedCandidate);
    const improved = verifiedCovered > initialCovered && selectionIsValid(verifiedCandidate);
    const repairedSelection = !selectionIsValid(canonicalCandidate)
      && selectionIsValid(verifiedCandidate)
      && verifiedCovered >= initialCovered;
    if (!improved && !repairedSelection) {
      return {
        candidate: {
          ...canonicalCandidate,
          amount_verification: verificationMetadata(
            "kept_initial",
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
