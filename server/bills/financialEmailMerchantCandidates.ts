import type { ActualPayee } from "../../shared/types/actual.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";

const MIN_MERCHANT_LENGTH = 4;
const MIN_SIMILARITY = 0.6;
const MAX_CANDIDATE_BUNDLES = 8;

interface MerchantCandidate {
  payeeId: string;
  score: number;
}

interface HistoryGroup {
  key: string;
  score: number;
  count: number;
  latestDate: string;
}

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityValues(candidate: BillCandidate): string[] {
  return [...new Set([
    candidate.payee,
    candidate.payee_hint,
    candidate.payee_label,
    candidate.schedule_name,
  ].map(normalizeIdentity).filter(Boolean))];
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function tokenSimilarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  return longest ? 1 - editDistance(left, right) / longest : 0;
}

function merchantSimilarity(identity: string, payeeName: string): number {
  const identityTokens = identity.split(" ").filter(Boolean);
  const payeeTokens = payeeName.split(" ").filter(Boolean);
  if (!identityTokens.length || !payeeTokens.length) return 0;
  if (payeeName.length < MIN_MERCHANT_LENGTH) return 0;

  const exactSequence = identityTokens.some((_, start) => (
    payeeTokens.every((token, offset) => identityTokens[start + offset] === token)
  ));
  if (exactSequence) return 1;

  const matched = payeeTokens.map((payeeToken) => (
    Math.max(...identityTokens.map((identityToken) => tokenSimilarity(payeeToken, identityToken)))
  ));
  return matched.reduce((sum, score) => sum + score, 0) / matched.length;
}

function candidatePayees(candidate: BillCandidate, payees: ActualPayee[]): MerchantCandidate[] {
  const identities = identityValues(candidate);
  if (!identities.length) return [];
  return payees.flatMap((payee) => {
    const normalizedPayee = normalizeIdentity(payee.name);
    const score = Math.max(...identities.map((identity) => merchantSimilarity(identity, normalizedPayee)));
    return payee.id && score >= MIN_SIMILARITY ? [{ payeeId: payee.id, score }] : [];
  });
}

/**
 * Retrieves a bounded set of real Actual-backed history rows for semantic
 * merchant selection. Similarity only discovers candidates; callers must still
 * require the constrained ranker to select one before treating it as evidence.
 */
export function discoverCorroboratedMerchantHistory({
  candidate,
  payees,
  history,
  direction,
  accountId = null,
}: {
  candidate: BillCandidate;
  payees: ActualPayee[];
  history: TransactionRecord[];
  direction: TransactionRecord["direction"];
  accountId?: string | null;
}): TransactionRecord[] {
  const candidates = candidatePayees(candidate, payees);
  const scores = new Map(candidates.map((entry) => [entry.payeeId, entry.score]));
  if (!scores.size) return [];

  const eligibleRows = history.filter((row) => (
    row.direction === direction
    && Boolean(row.accountId && row.payeeId)
    && scores.has(row.payeeId!)
    && (!accountId || row.accountId === accountId)
  ));
  const groups = new Map<string, HistoryGroup>();
  for (const row of eligibleRows) {
    const key = `${row.accountId}:${row.payeeId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (row.date > existing.latestDate) existing.latestDate = row.date;
      continue;
    }
    groups.set(key, {
      key,
      score: scores.get(row.payeeId!)!,
      count: 1,
      latestDate: row.date,
    });
  }

  const selectedKeys = new Set([...groups.values()]
    .filter((group) => group.count >= 2)
    .sort((left, right) => (
      right.score - left.score
      || right.count - left.count
      || right.latestDate.localeCompare(left.latestDate)
      || left.key.localeCompare(right.key)
    ))
    .slice(0, MAX_CANDIDATE_BUNDLES)
    .map((group) => group.key));
  return eligibleRows.filter((row) => selectedKeys.has(`${row.accountId}:${row.payeeId}`));
}

