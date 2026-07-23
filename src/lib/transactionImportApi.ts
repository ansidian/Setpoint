import { apiFetch } from "./apiFetch";
import type {
  TransactionImportConfirmation,
  TransactionImportEmailStatusResponse,
  TransactionImportHistoricalScanRequest,
  TransactionImportMapping,
  TransactionImportMappingUpdate,
  TransactionImportRunDetail,
  TransactionImportRunListResponse,
  TransactionImportSource,
} from "../../shared/types/transaction-imports";

export const getTransactionImportMappings = (): Promise<TransactionImportMapping[]> =>
  apiFetch("/api/briefing/transaction-imports/mappings");

export const updateTransactionImportMapping = (
  source: TransactionImportSource,
  mapping: TransactionImportMappingUpdate,
): Promise<TransactionImportMapping> => apiFetch(`/api/briefing/transaction-imports/mappings/${encodeURIComponent(source)}`, {
  method: "PUT",
  body: JSON.stringify(mapping),
});

export const listTransactionImportRuns = (limit = 12): Promise<TransactionImportRunListResponse> =>
  apiFetch(`/api/briefing/transaction-imports/runs?limit=${encodeURIComponent(limit)}`);

export const startTransactionImportScan = (
  request: TransactionImportHistoricalScanRequest,
): Promise<{ runId: string; created: boolean }> => apiFetch("/api/briefing/transaction-imports/runs", {
  method: "POST",
  body: JSON.stringify(request),
});

export const getTransactionImportRun = (runId: string): Promise<TransactionImportRunDetail> =>
  apiFetch(`/api/briefing/transaction-imports/runs/${encodeURIComponent(runId)}`);

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
