import ActualActionStatus from "./ActualActionStatus";
import {
  TransactionImportStatusView,
} from "./TransactionImportStatus";
import { resolveEmailActualStatusSource } from "./emailActualStatusModel";
import { resolveTransactionImportStatus } from "./transactionImportStatusModel";
import useTransactionImportStatus from "./useTransactionImportStatus";
import type { CSSProperties } from "react";
import type { ActualResolutionLike } from "./actualActionStatusModel";
import FinancialEventStatus from "../../bills/FinancialEventStatus";

export default function EmailActualStatus({
  emailUid,
  billResolution,
  style,
}: {
  emailUid: string;
  billResolution: ActualResolutionLike | null | undefined;
  style?: CSSProperties;
}) {
  const transactionImportState = useTransactionImportStatus(emailUid);
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
