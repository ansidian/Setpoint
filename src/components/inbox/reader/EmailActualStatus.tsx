import ActualActionStatus from "./ActualActionStatus";
import {
  TransactionImportStatusView,
} from "./TransactionImportStatus";
import { resolveEmailActualStatusSource } from "./emailActualStatusModel";
import { resolveTransactionImportStatus } from "./transactionImportStatusModel";
import type useTransactionImportStatus from "./useTransactionImportStatus";
import type { CSSProperties } from "react";
import type { ActualResolutionLike } from "./actualActionStatusModel";
import FinancialEventStatus from "../../bills/FinancialEventStatus";

/** Renders the reader's already-loaded financial status; the reader owns the single status read. */
export default function EmailActualStatus({
  status: transactionImportState,
  billResolution,
  style,
}: {
  status: ReturnType<typeof useTransactionImportStatus>;
  billResolution: ActualResolutionLike | null | undefined;
  style?: CSSProperties;
}) {
  const source = resolveEmailActualStatusSource({
    transactionImportItems: transactionImportState.items,
    billResolution,
  });

  if (transactionImportState.financialEvent?.workflow) {
    return <FinancialEventStatus plan={transactionImportState.financialEvent} style={style} />;
  }

  if (source === "transaction_import") {
    const view = resolveTransactionImportStatus(transactionImportState.items);
    return view ? <TransactionImportStatusView view={view} style={style} /> : null;
  }
  if (source === "actual") {
    return <ActualActionStatus resolution={billResolution} style={style} />;
  }
  return null;
}
