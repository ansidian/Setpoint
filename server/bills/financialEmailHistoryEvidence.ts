import type { BillCandidate, FinancialTargetConfidence, FinancialTargetKind, FinancialTargetProvenance } from "../../shared/types/bills.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";
import type { TargetEvidence, TargetValue } from "./financialEmailImportedHistory.ts";
import type { FinancialTargetBundleRanker } from "./financialEmailTargetInference.ts";
import type { FinancialTargetRankingResult } from "./financialEmailTargetRanker.ts";

interface HistoryBundle {
  key: string;
  account: TargetValue;
  payee: TargetValue;
  count: number;
  latestDate: string;
}
function historyProvenance(
  confidence: FinancialTargetConfidence,
  reason: string,
): FinancialTargetProvenance {
  return { source: "actual_history", confidence, reason };
}
export function historyBundles(rows: TransactionRecord[]): HistoryBundle[] {
  const bundles = new Map<string, HistoryBundle>();
  for (const row of rows) {
    if (!row.accountId || !row.payeeId) continue;
    const key = [row.accountId, row.payeeId].join(":");
    const existing = bundles.get(key);
    if (existing) {
      existing.count += 1;
      if (row.date > existing.latestDate) existing.latestDate = row.date;
      continue;
    }
    bundles.set(key, {
      key,
      account: { id: row.accountId, label: row.account },
      payee: { id: row.payeeId, label: row.payee },
      count: 1,
      latestDate: row.date,
    });
  }
  return [...bundles.values()].sort((left, right) => right.latestDate.localeCompare(left.latestDate));
}

export function stableHistoryEvidence(
  kind: FinancialTargetKind,
  values: TargetValue[],
  totalRows: number,
): TargetEvidence[] {
  if (totalRows < 2 || values.length !== totalRows) {
    return [...new Map(values.map((value) => [value.id || value.label, value])).values()]
      .map((value) => ({
        ...value,
        tier: 3,
        decisive: false,
        selectable: false,
        provenance: historyProvenance(
          "medium",
          totalRows < 2 ? "single_matching_transaction" : `incomplete_${kind}_history`,
        ),
      }));
  }
  const unique = new Map(values.map((value) => [value.id || value.label, value]));
  if (unique.size === 1 && values.length === totalRows) {
    return [{
      ...values[0]!,
      tier: 3,
      decisive: true,
      provenance: historyProvenance("high", `stable_${kind}_history`),
    }];
  }
  return [...unique.values()].map((value) => ({
    ...value,
    tier: 3,
    decisive: false,
    selectable: false,
    provenance: historyProvenance("medium", `mixed_${kind}_history`),
  }));
}

export async function rankHistoryBundles(
  candidate: BillCandidate,
  bundles: HistoryBundle[],
  rankBundles: FinancialTargetBundleRanker | undefined,
  { allowSingle = false }: { allowSingle?: boolean } = {},
): Promise<{ bundle: HistoryBundle; ranking: FinancialTargetRankingResult } | null> {
  if (!rankBundles || bundles.length < (allowSingle ? 1 : 2) || bundles.length > 8) return null;
  const keyed = bundles.map((bundle, index) => ({
    bundle,
    option: {
      key: `option_${index + 1}`,
      description: [bundle.account.label, bundle.payee.label]
        .filter(Boolean)
        .join(" · "),
    },
  }));
  const ranked = await rankBundles({ candidate, options: keyed.map((entry) => entry.option) });
  if (ranked.status !== "selected" || !ranked.key) return null;
  const selected = keyed.find((entry) => entry.option.key === ranked.key)?.bundle || null;
  return selected ? { bundle: selected, ranking: ranked } : null;
}

export function modelEvidence(value: TargetValue, evidence: string | null): TargetEvidence {
  return {
    ...value,
    tier: 5,
    decisive: false,
    provenance: {
      source: "model_ranking",
      confidence: "high",
      reason: "constrained_history_bundle_ranking",
      evidence,
    },
  };
}
