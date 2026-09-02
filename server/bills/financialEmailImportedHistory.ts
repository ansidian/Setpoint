import type { ActualMetadata } from "../../shared/types/actual.ts";
import type {
  BillCandidate,
  FinancialTargetKind,
  FinancialTargetProvenance,
} from "../../shared/types/bills.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";

export interface TargetValue {
  id: string | null;
  label: string;
}

export interface TargetEvidence extends TargetValue {
  tier: 1 | 2 | 3 | 5;
  decisive: boolean;
  selectable?: boolean;
  provenance: FinancialTargetProvenance;
}

function evidence(kind: FinancialTargetKind, value: TargetValue | null): TargetEvidence[] {
  return value ? [{
    ...value,
    tier: 1,
    decisive: true,
    provenance: {
      source: "actual_history",
      confidence: "exact",
      reason: `exact_imported_id_${kind}`,
    },
  }] : [];
}

export function exactImportedTargetEvidence(
  candidate: BillCandidate,
  history: TransactionRecord[],
  metadata: ActualMetadata,
): { account: TargetEvidence[]; payee: TargetEvidence[]; category: TargetEvidence[] } {
  const importedId = candidate.transaction_import?.importedId;
  const transaction = importedId
    ? history.find((row) => row.importedId === importedId)
    : null;
  const category = transaction?.categoryId
    ? metadata.categories.flatMap((group) => group.categories || [])
      .find((entry) => entry.id === transaction.categoryId)
    : null;
  return {
    account: evidence("account", transaction?.accountId
      ? { id: transaction.accountId, label: transaction.account }
      : null),
    payee: evidence("payee", transaction?.payeeId
      ? { id: transaction.payeeId, label: transaction.payee }
      : null),
    category: evidence("category", category
      ? { id: category.id, label: category.name }
      : null),
  };
}
