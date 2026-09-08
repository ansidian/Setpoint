import { apiFetch } from "./apiFetch";
import type {
  TransactionImportConfirmation,
  TransactionImportEmailStatusResponse,
} from "../../shared/types/transaction-imports";

export const commitTransactionImportItems = (
  runId: string,
  items: TransactionImportConfirmation[],
): Promise<{ accepted: number }> => apiFetch(`/api/briefing/transaction-imports/runs/${encodeURIComponent(runId)}/commit`, {
  method: "POST",
  body: JSON.stringify({ items }),
});

export const retryTransactionImportItem = (itemId: string): Promise<{ accepted: boolean }> =>
  apiFetch(`/api/briefing/transaction-imports/items/${encodeURIComponent(itemId)}/retry`, { method: "POST" });

export const dismissTransactionImportItem = (itemId: string): Promise<{ dismissed: boolean }> =>
  apiFetch(`/api/briefing/transaction-imports/items/${encodeURIComponent(itemId)}/dismiss`, { method: "POST" });

export const getTransactionImportEmailStatus = (emailUid: string): Promise<TransactionImportEmailStatusResponse> =>
  apiFetch(`/api/briefing/transaction-imports/email-status?emailUid=${encodeURIComponent(emailUid)}`);
