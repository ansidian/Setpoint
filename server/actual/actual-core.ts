import { reconcileActualTransferSchedule } from "./actualTransferSchedules.ts";
import type { ActualTransferScheduleInput, ActualTransferScheduleMode } from "../../shared/types/transaction-imports.ts";
import actualApi from "@actual-app/api";
import { decrypt } from "../platform/encryption.ts";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import { filterBillSchedulesForRange } from "./actual-bill-occurrences.ts";
import {
  actualDataDir,
  findLocalBudgetDir,
  hydrateLocalActualCache,
  pruneActualBudgetBackups,
} from "./actual-local-metadata.ts";
import {
  actualSessionKey,
  classifySchedules,
  mapOpenBillInstances,
  transactionSearchStart,
  projectSdkMetadata,
  mapRecentTransactions,
  mapUpcomingBills,
} from "./actualCoreModel.ts";
import db from "../db/connection.ts";
import { ActualPasswordRequiredForServerChangeError, isSameActualServerUrl } from "./actual-connection-test.ts";
import type {
  ActualAccount,
  ActualCategoryGroup,
  ActualConfig,
  ActualMetadata,
  ActualPayee,
  ActualRecentTransaction,
  ActualSchedule,
} from "../../shared/types/actual.ts";
import type {
  ActualImportAccountGroup,
  ActualImportBatchResult,
} from "../../shared/types/transaction-imports.ts";
import {
  runActualTransactionImport,
  type SdkImportTransactionInput,
  type SdkImportResult,
} from "./actualTransactionImportModel.ts";
import {
  createActualSdkScheduleWrites,
  type ActualBillData,
  type ActualSdkSchedulePort,
} from "./actualSdkScheduleWrites.ts";

type ActualError = Error & { status?: number; code?: string };
interface SdkActualConfig extends ActualConfig {
  dataDir: string;
  localBudgetId: string;
  localBudgetDir: string;
}
interface ActiveBudget extends SdkActualConfig {
  key: string;
  loadedAt: string;
}
interface ActualConnectionOverrides {
  serverURL?: string;
  syncId?: string;
  password?: string | null;
}
interface QuickTransactionInput {
  accountName?: string;
  amount?: number;
  payee?: string;
  type?: string;
  date?: string;
  notes?: string;
  categoryName?: string;
}
interface SdkTransactionInput {
  date: string;
  amount: number;
  payee?: string;
  payee_name?: string;
  category?: string;
  notes?: string;
  cleared?: boolean;
}
interface QueryBuilder {
  filter(value: unknown): QueryBuilder;
  select(fields: string[]): QueryBuilder;
  withDead(): QueryBuilder;
  withoutValidatedRefs(): QueryBuilder;
}
interface ActualSdk extends ActualSdkSchedulePort {
  init(options: { serverURL: string; password?: string | null; dataDir?: string }): Promise<void>;
  shutdown(): Promise<void>;
  loadBudget(id: string): Promise<{ error?: string } | void>;
  getBudgets(): Promise<Array<{ groupId?: string }>>;
  getAccounts(): Promise<ActualAccount[]>;
  getPayees(): Promise<ActualPayee[]>;
  getCategoryGroups(): Promise<ActualCategoryGroup[]>;
  q(dataset: string): QueryBuilder;
  runQuery(query: QueryBuilder): Promise<{ data: unknown[] }>;
  addTransactions(accountId: string, transactions: SdkTransactionInput[]): Promise<void>;
  importTransactions(accountId: string, transactions: SdkImportTransactionInput[], options: { dryRun: boolean }): Promise<SdkImportResult>;
  sync(): Promise<void>;
  internal: { send(operation: string, payload: unknown): Promise<unknown> };
}

const sdk = actualApi as unknown as ActualSdk;
const scheduleWrites = createActualSdkScheduleWrites(sdk);

export { isSchedulePaid } from "./actual-bill-occurrences.ts";

async function getActualConfig(userId: string): Promise<ActualConfig> {
  const result = await db.execute({
    sql: "SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  const settings = result.rows[0];
  if (!settings?.actual_budget_url || !settings?.actual_budget_sync_id) {
    throw new Error("Actual Budget not configured in EA settings");
  }
  return {
    serverURL: String(settings.actual_budget_url).replace(/\/+$/, ""),
    password: settings.actual_budget_password_encrypted
      ? decrypt(String(settings.actual_budget_password_encrypted), settingsCredentialContext(userId, "actual_budget_password_encrypted"))
      : null,
    syncId: String(settings.actual_budget_sync_id),
  };
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
function allowColdActualHydration(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.EA_ACTUAL_ALLOW_COLD_SDK_DOWNLOAD === "1";
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

async function ensureActualBudget(userId: string): Promise<SdkActualConfig> {
  const baseConfig = await getActualConfig(userId);
  const dataDir = actualDataDir();
  const localBudget = await findLocalBudgetDir(baseConfig.syncId, { dataDir }).catch((err: unknown) => {
    console.warn("[EA] Actual local budget lookup failed; falling back to bounded cache hydration:", err instanceof Error ? err.message : err);
    return null;
  });
  let localBudgetId = localBudget?.metadata?.id || null;
  let localBudgetDir = localBudget?.budgetDir || null;
  if (!localBudgetId || !localBudgetDir) {
    if (!allowColdActualHydration()) {
      throw Object.assign(new Error("Actual local budget cache is unavailable; refusing cold Actual download in production"), {
        status: 503,
        code: "ACTUAL_LOCAL_BUDGET_REQUIRED",
      });
    }
    const hydrated = await hydrateLocalActualCache(userId, { dataDir, forceDownload: true });
    localBudgetId = typeof hydrated.budgetId === "string" && hydrated.budgetId ? hydrated.budgetId : null;
    localBudgetDir = typeof hydrated.budgetDir === "string" && hydrated.budgetDir ? hydrated.budgetDir : null;
    if (!localBudgetId || !localBudgetDir) {
      throw Object.assign(new Error("Actual cache hydration completed without a loadable local budget"), {
        status: 502,
        code: "ACTUAL_LOCAL_BUDGET_HYDRATION_FAILED",
      });
    }
  }
  const config: SdkActualConfig = {
    ...baseConfig,
    dataDir,
    localBudgetId,
    localBudgetDir,
  };
  const key = actualSessionKey(config);
  if (activeBudget?.key === key) return config;
  if (activeBudget) {
    await closeActualSession();
  }
  try {
    await sdk.init({ serverURL: config.serverURL, password: config.password, dataDir });
    const result = await sdk.loadBudget(config.localBudgetId);
    if (result?.error) {
      throw Object.assign(new Error(`Actual local budget load failed: ${result.error}`), {
        status: 503,
        code: "ACTUAL_LOCAL_BUDGET_LOAD_FAILED",
      });
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
    if (config.localBudgetDir) {
      await maybePruneBackups(config.localBudgetDir);
    }
    return result;
  } catch (error) {
    await closeActualSession();
    throw error;
  }
}

// --- Metadata cache: 5-minute TTL ---
const METADATA_TTL_MS = 5 * 60 * 1000;
let metadataCache: { data: ActualMetadata | null; ts: number } = { data: null, ts: 0 };

export function clearMetadataCache(): void {
  metadataCache = { data: null, ts: 0 };
}

export function testConnection(userId: string, overrides: ActualConnectionOverrides | null = null) {
  return withLock(async () => {
    let serverURL: string;
    let password: string | null | undefined;
    let syncId: string;
    if (overrides && overrides.serverURL && overrides.syncId) {
      serverURL = overrides.serverURL.replace(/\/+$/, "");
      syncId = overrides.syncId;
      if (overrides.password) {
        password = overrides.password;
      } else {
        // Dirty URL/sync-id but password unchanged — fall back to stored password
        const stored = await getActualConfig(userId).catch(() => null);
        if (stored && !isSameActualServerUrl(serverURL, stored.serverURL)) {
          throw new ActualPasswordRequiredForServerChangeError();
        }
        password = stored?.password || null;
      }
    } else {
      ({ serverURL, password, syncId } = await getActualConfig(userId));
    }

    try {
      await sdk.init({ serverURL, password });
      // getBudgets validates auth + connectivity without downloading/syncing
      const budgets = await sdk.getBudgets();
      const found = budgets.some((b) => b.groupId === syncId);
      return {
        success: true,
        budgetCount: budgets.length,
        budgetFound: found,
      };
    } finally {
      await closeActualSession();
    }
  });
}

// Fetch all Actual Budget metadata in a single connection (accounts, payees, categories)
// The @actual-app/api is a singleton — parallel init/shutdown calls conflict,
// so we batch everything into one connection.
// Cache check is inside withLock to prevent cache stampede (D-03 from RESEARCH.md).
export function getMetadata(userId: string, { forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<ActualMetadata> {
  return withLock(() => getMetadataInner(userId, { forceRefresh }));
}

// Inner body — assumes caller already holds the withLock mutex. Lets operations
// like createQuickTxn chain metadata fetch + mutation inside one critical section
// without re-entering the lock (which would serialize against itself).
async function getMetadataInner(userId: string, { forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<ActualMetadata> {
    const now = Date.now();
    if (!forceRefresh && metadataCache.data && now - metadataCache.ts < METADATA_TTL_MS) {
      return metadataCache.data;
    }

    if (forceRefresh) {
      clearMetadataCache();
      await closeActualSession();
    }

    return withActualBudget(userId, async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const [rawAccounts, rawPayees, groups, schedules, recentTxns] = await Promise.all([
        sdk.getAccounts(),
        sdk.getPayees(),
        sdk.getCategoryGroups(),
        scheduleWrites.readSchedules().catch(() => []),
        sdk.runQuery(
          sdk.q("transactions")
            .filter({ date: { $gte: monthAgo } })
            .select(["id", "date", "amount", "payee", "schedule"])
        ).then((r) => r.data as Array<{ id?: string; date: string; amount?: number; payee?: string; schedule?: string }>).catch(() => []),
      ]);

      const result = projectSdkMetadata({ rawAccounts, rawPayees, groups, schedules, recentTxns });
      metadataCache = { data: result, ts: Date.now() };
      return result;
    });
}

// Individual accessors for routes/services that only need one metadata slice.
export async function getAccounts(userId: string): Promise<ActualAccount[]> {
  const { accounts } = await getMetadata(userId);
  return accounts;
}

export async function getRecentTransactions(userId: string): Promise<ActualRecentTransaction[]> {
  const { recentTransactions } = await getMetadata(userId);
  return recentTransactions;
}

export async function getPayees(userId: string): Promise<ActualPayee[]> {
  const { payees } = await getMetadata(userId);
  return payees;
}

export async function getCategories(userId: string): Promise<ActualCategoryGroup[]> {
  const { categories } = await getMetadata(userId);
  return categories;
}



async function getRecentTransactionsForSchedules(schedules: ActualSchedule[], payeeMap: Record<string, string>): Promise<ActualRecentTransaction[]> {
  const start = transactionSearchStart(schedules);
  if (!start) return [];
  return sdk.runQuery(
    sdk.q("transactions")
      .filter({ date: { $gte: start } })
      .select(["id", "date", "amount", "payee", "schedule"])
  ).then((result) => mapRecentTransactions(result.data as Array<{ id?: string; payee?: string | null; amount?: number | null; date: string; schedule?: string | null }>, payeeMap)).catch(() => []);
}

export async function getUpcomingBills(userId: string) {
  const { schedules, payeeMap, recentTransactions } = await getMetadata(userId);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  return mapUpcomingBills(schedules, payeeMap, recentTransactions, { today, weekFromNow });
}

export function getCalendarBillsRange(userId: string, { start, end }: { start: string; end: string }) {
  return withLock(async () => {
    return withActualBudget(userId, async ({ serverURL }) => {
      const [rawPayees, schedules] = await Promise.all([
        sdk.getPayees(),
        scheduleWrites.readSchedules(),
      ]);

      const payeeMap = Object.fromEntries(rawPayees.map((p) => [p.id, p.name]));
      const classifiedSchedules = classifySchedules(schedules, rawPayees);
      const billSchedules = filterBillSchedulesForRange(classifiedSchedules, { start, end });
      const recentTransactions = await getRecentTransactionsForSchedules(billSchedules, payeeMap);

      return {
        schedules: mapOpenBillInstances(billSchedules, payeeMap, { start, end, recentTransactions }),
        recentTransactions,
        payeeMap,
        actualBudgetUrl: serverURL,
      };
    });
  });
}

export function markBillPaid(scheduleId: string, userId: string) {
  return withLock(async () => {
    return withActualBudget(userId, async () => {
      await sdk.internal.send("schedule/post-transaction", { id: scheduleId });
      await sdk.sync();
      clearMetadataCache();
      return { success: true };
    });
  });
}

export function sendBill(billData: ActualBillData, userId: string) {
  return withLock(async () => {
    return withActualBudget(userId, async () => {
      const result = await scheduleWrites.writeBill(billData);
      await sdk.sync();
      clearMetadataCache();
      return result;
    });
  });
}

// One-shot transaction post for mobile shortcuts (Tap-to-Pay). Resolves account
// and optional category by name, then writes a single cleared=false transaction.
export function createQuickTxn(userId: string, { accountName, amount, payee, type = "payment", date, notes, categoryName }: QuickTransactionInput) {
  return withLock(async () => {
    if (!accountName || amount == null || !payee) {
      const e: ActualError = new Error("accountName, amount, and payee are required");
      e.status = 400;
      throw e;
    }

    const meta = await getMetadataInner(userId);
    const acct = meta.accounts.find(a => a.name.toLowerCase() === String(accountName).toLowerCase());
    if (!acct) {
      const e: ActualError = new Error(`Account "${accountName}" not found in Actual Budget`);
      e.status = 404;
      throw e;
    }

    let categoryId = null;
    if (categoryName) {
      for (const group of meta.categories) {
        const match = group.categories.find(c => c.name.toLowerCase() === String(categoryName).toLowerCase());
        if (match) { categoryId = match.id; break; }
      }
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const txnDate = date || today;
    const amountCents = Math.round(Math.abs(Number(amount)) * 100);
    const signed = type === "deposit" ? amountCents : -amountCents;

    return withActualBudget(userId, async () => {
      const txn: SdkTransactionInput = {
        date: txnDate,
        amount: signed,
        payee_name: payee,
        notes: notes || "Tap-to-Pay",
        cleared: false,
      };
      if (categoryId) txn.category = categoryId;

      await sdk.addTransactions(acct.id, [txn]);
      await sdk.sync();

      // Invalidate cached recentTransactions so bill-paid detection sees this txn
      clearMetadataCache();

      return {
        success: true,
        account: acct.name,
        payee,
        amount: Math.abs(Number(amount)),
        type,
        date: txnDate,
        category: categoryName || null,
      };
    });
  });
}

export function importTransactionGroups(
  userId: string,
  groups: ActualImportAccountGroup[],
  dryRun: boolean,
): Promise<ActualImportBatchResult> {
  return withLock(async () => {
    return withActualBudget(userId, async () => {
      const result = await runActualTransactionImport({
        groups,
        dryRun,
        importTransactions: (accountId, transactions, options) => sdk.importTransactions(accountId, transactions, options),
        sync: () => sdk.sync(),
      });
      if (!dryRun) clearMetadataCache();
      return result;
    });
  });
}

export function reconcileTransferSchedule(userId: string, input: ActualTransferScheduleInput, mode: ActualTransferScheduleMode) {
  return withLock(() => withActualBudget(userId, async (config) => {
    const result = await reconcileActualTransferSchedule(sdk, config.syncId, input, mode);
    clearMetadataCache();
    return result;
  }));
}
