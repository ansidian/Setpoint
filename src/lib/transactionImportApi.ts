import { apiFetch } from "./apiFetch";
import type { TransactionImportEmailStatusResponse } from "../../shared/types/transaction-imports";

export const getTransactionImportEmailStatus = (emailUid: string): Promise<TransactionImportEmailStatusResponse> =>
  apiFetch(`/api/briefing/transaction-imports/email-status?emailUid=${encodeURIComponent(emailUid)}`);
