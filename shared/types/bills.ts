import type { ActualBillOccurrence } from "./actual.ts";

/** Freshness of the local mirror of Actual schedules. */
export interface BillsMirrorHealth {
  state: string;
  configured?: boolean | null;
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  pendingRefreshAt?: string | null;
  refreshStartedAt?: string | null;
}

export interface BillsMirrorPayload {
  bills: ActualBillOccurrence[];
  allSchedules: ActualBillOccurrence[];
  payeeMap: Record<string, string>;
  actualConfigured: boolean;
  actualBudgetUrl: string | null;
  syncHealth?: BillsMirrorHealth;
  billsSyncHealth: BillsMirrorHealth;
}

export interface ActualConnectionOverrides {
  serverURL: string;
  password?: string | null;
  syncId: string;
  encryptionPassword?: string | null;
}

export interface ActualConnectionResponse {
  success: boolean;
  message?: string;
  budgetEncrypted?: boolean;
  [key: string]: unknown;
}

export interface ActualCacheStatusResponse {
  success: true;
  configured: boolean;
  hydrated: boolean;
  actualDataDir: string;
  message?: string;
  [key: string]: unknown;
}

export interface ActualCacheHydrationResponse {
  success?: boolean;
  message?: string;
  hydrated?: boolean;
  billsCount?: number;
  schedulesCount?: number;
  syncHealth?: BillsMirrorHealth | null;
  [key: string]: unknown;
}
