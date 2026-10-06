import type { Client } from "@libsql/client";
import type { TodoistMirrorHealth } from "../../shared/types/tasks.ts";
import type {
  CurrentDashboardCacheKey,
  CurrentDashboardCacheRow,
  CurrentDashboardCacheRows,
} from "../../shared/types/dashboard.ts";
import type { UserConfig } from "../platform/config-service.ts";

export interface CurrentProviderContext {
  todoistHealth?: TodoistMirrorHealth | null;
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
  fetchedAt?(payload: unknown): string | null;
  refreshReasonOverride?(input: CurrentProviderHookInput): string | null;
  manualRefreshReason?(input: CurrentProviderHookInput): string | null;
}

export interface DeadlinesPayload extends Record<string, unknown> {
  upcoming: Array<Record<string, unknown>>;
  stats: unknown;
}

export interface CurrentDashboardServiceOptions {
  dbClient?: Client;
  now?: Date;
}

export interface CurrentRefreshRunnerOptions extends CurrentDashboardServiceOptions {
  force?: boolean;
  forceKeys?: Set<CurrentDashboardCacheKey>;
}

export type { CurrentDashboardCacheRow, CurrentDashboardCacheRows };
