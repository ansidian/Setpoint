import type { Client } from "@libsql/client";
import type { BillsMirrorHealth, BillsMirrorPayload } from "../../shared/types/bills.ts";
import type { TodoistMirrorHealth } from "../../shared/types/tasks.ts";
import type {
  CurrentDashboardCacheKey,
  CurrentDashboardCacheRow,
  CurrentDashboardCacheRows,
} from "../../shared/types/dashboard.ts";
import type { UserConfig } from "../platform/config-service.ts";

export interface CurrentProviderContext {
  todoistHealth?: TodoistMirrorHealth | null;
  billsMirror?: {
    row?: Record<string, unknown> | null;
    syncHealth?: BillsMirrorHealth;
    actualBudgetUrl?: string | null;
  } | null;
}

export interface CurrentProviderOptions {
  dbClient?: Client;
  now?: Date;
  force?: boolean;
}

export interface CurrentProviderHookInput {
  row?: CurrentDashboardCacheRow;
  now: Date;
  context: CurrentProviderContext;
}

export interface CurrentDashboardProvider {
  readonly key: CurrentDashboardCacheKey;
  readonly cacheTtlMs: number;
  fallbackPayload(): unknown;
  hasUsablePayload(payload: unknown): boolean;
  fetchFresh(userId: string, config: UserConfig, options?: CurrentProviderOptions): Promise<unknown>;
  visibleProjection?(payload: unknown): unknown;
  shouldPublishChange?(
    previousRow: CurrentDashboardCacheRow | null | undefined,
    previousPayload: unknown,
    nextPayload: unknown,
  ): boolean;
  refreshReasonOverride?(input: CurrentProviderHookInput): string | null;
  manualRefreshReason?(input: CurrentProviderHookInput): string | null;
  passiveSuppressReason?(input: CurrentProviderHookInput): string | null;
  maintenanceRefreshReason?(input: CurrentProviderHookInput): string | null;
  onRefreshed?(
    userId: string,
    previous: {
      previousRow: CurrentDashboardCacheRow | undefined;
      previousPayload: unknown;
    },
    nextPayload: unknown,
    options?: { now?: Date; refreshReason?: string | null },
  ): void;
}

export interface DeadlinesPayload extends Record<string, unknown> {
  upcoming: Array<Record<string, unknown>>;
  stats: unknown;
}

export type BillsCurrentPayload = BillsMirrorPayload & Record<string, unknown>;

export interface CurrentDashboardServiceOptions {
  dbClient?: Client;
  now?: Date;
}

export interface CurrentRefreshRunnerOptions extends CurrentDashboardServiceOptions {
  force?: boolean;
  forceKeys?: Set<CurrentDashboardCacheKey>;
  refreshReasons?: Partial<Record<CurrentDashboardCacheKey, string>>;
}

export type { CurrentDashboardCacheRow, CurrentDashboardCacheRows };
