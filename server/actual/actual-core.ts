import actualApi from "@actual-app/api";
import { rm } from "fs/promises";
import {
  actualDataDir,
  findLocalBudgetDir,
  getActualConfig,
  pruneActualBudgetBackups,
  describeLocalActualCache,
  readLocalActualMetadata,
} from "./actual-local-metadata.ts";
import type { ActualConfig, ActualMetadata } from "../../shared/types/actual.ts";

interface SdkActualConfig extends ActualConfig {
  dataDir: string;
}
interface ActiveBudget extends SdkActualConfig {
  key: string;
  loadedAt: string;
}
interface ActualSdk {
  init(options: { serverURL: string; password?: string | null; dataDir?: string }): Promise<void>;
  shutdown(): Promise<void>;
  downloadBudget(syncId: string, options?: { password?: string }): Promise<void>;
  sync(): Promise<void>;
}

const sdk = actualApi as unknown as ActualSdk;

// A changed server, credential, budget or encryption password needs a new SDK session.
function actualSessionKey(config: SdkActualConfig): string {
  return JSON.stringify([config.serverURL, config.password || "", config.syncId, config.encryptionPassword || "", config.dataDir]);
}

// A local copy written before end-to-end encryption, or before a key change,
// cannot decrypt new sync messages. These outcomes are recovered by replacing
// the read-only cache with a fresh download; network failures never discard it.
const STALE_LOCAL_COPY_ERRORS = new Set(["decrypt-failure", "file-has-new-key", "file-key-mismatch", "missing-key"]);

function sdkErrorCode(error: unknown): string | null {
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  return typeof code === "string" ? code : null;
}

// --- Mutex: serialize all Actual Budget API access (singleton contention prevention) ---
let lock: Promise<unknown> = Promise.resolve();
let activeBudget: ActiveBudget | null = null;

// PERF-L08: pruning is a readdir+stat sweep and backups only appear on SDK
// snapshots, so once per interval per budget directory is sufficient.
const BACKUP_PRUNE_INTERVAL_MS = 15 * 60 * 1000;
const lastBackupPruneAt = new Map<string, number>();

async function maybePruneBackups(budgetDir: string): Promise<void> {
  const now = Date.now();
  if ((lastBackupPruneAt.get(budgetDir) ?? 0) + BACKUP_PRUNE_INTERVAL_MS > now) return;
  lastBackupPruneAt.set(budgetDir, now);
  await pruneActualBudgetBackups(budgetDir).catch((err: unknown) => {
    console.warn("[EA] Actual local backup pruning failed:", err instanceof Error ? err.message : err);
  });
}

function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const result = lock.then(() => fn());
  lock = result.catch(() => {});
  return result;
}

async function closeActualSession(): Promise<void> {
  activeBudget = null;
  await sdk.shutdown().catch(() => {});
}

// downloadBudget loads an existing local copy and syncs it, or downloads the
// file when none exists. The encryption password unlocks end-to-end encrypted
// budgets; the SDK keeps the derived key in memory only for this session.
async function openBudget(config: SdkActualConfig): Promise<void> {
  await sdk.init({ serverURL: config.serverURL, password: config.password, dataDir: config.dataDir });
  await sdk.downloadBudget(config.syncId, config.encryptionPassword ? { password: config.encryptionPassword } : undefined);
}

async function ensureActualBudget(userId: string): Promise<SdkActualConfig> {
  const config: SdkActualConfig = { ...await getActualConfig(userId), dataDir: actualDataDir() };
  const key = actualSessionKey(config);
  if (activeBudget?.key === key) return config;
  if (activeBudget) await closeActualSession();
  try {
    try {
      await openBudget(config);
    } catch (error) {
      const local = await findLocalBudgetDir(config.syncId, { dataDir: config.dataDir });
      if (!local || !STALE_LOCAL_COPY_ERRORS.has(sdkErrorCode(error) || "")) throw error;
      console.warn("[EA] Replacing the local Actual copy after a key error:", sdkErrorCode(error));
      await closeActualSession();
      await rm(local.budgetDir, { recursive: true, force: true });
      await openBudget(config);
    }
    activeBudget = { key, ...config, loadedAt: new Date().toISOString() };
    return config;
  } catch (error) {
    await closeActualSession();
    throw error;
  }
}

async function withActualBudget<T>(userId: string, fn: (config: SdkActualConfig) => T | Promise<T>): Promise<T> {
  const config = await ensureActualBudget(userId);
  try {
    const result = await fn(config);
    const local = await findLocalBudgetDir(config.syncId, { dataDir: config.dataDir });
    if (local) await maybePruneBackups(local.budgetDir);
    return result;
  } catch (error) {
    await closeActualSession();
    throw error;
  }
}

export function shutdownActual(): Promise<void> {
  return withLock(closeActualSession);
}

export function hydrateCache(userId: string) {
  return withLock(() => withActualBudget(userId, async () => {
    await sdk.sync();
    return describeLocalActualCache(userId);
  }));
}

export function syncMetadata(userId: string): Promise<ActualMetadata> {
  return withLock(() => withActualBudget(userId, async () => {
    await sdk.sync();
    return readLocalActualMetadata(userId, { localOnly: true });
  }));
}
