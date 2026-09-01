import { resolveActualActionStatusView } from "./actualActionStatusModel";
import { resolveTransactionImportStatus } from "./transactionImportStatusModel";
import type { ActualResolutionLike } from "./actualActionStatusModel";
import type { TransactionImportStatusItem } from "./transactionImportStatusModel";

export type EmailActualStatusSource = "transaction_import" | "actual";

export function resolveEmailActualStatusSource({
  transactionImportItems = [],
  billResolution,
}: {
  transactionImportItems?: readonly TransactionImportStatusItem[];
  billResolution?: ActualResolutionLike | null;
} = {}): EmailActualStatusSource | null {
  if (resolveTransactionImportStatus(transactionImportItems)) return "transaction_import";
  if (resolveActualActionStatusView(billResolution)) return "actual";
  return null;
}
