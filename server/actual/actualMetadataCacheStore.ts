// Filesystem cache layer for the local Actual budget copy: locating the on-disk
// budget directory by sync id, pruning stale zip backups, and summarizing disk
// usage. Network/DB-free — operates purely on the data dir and its budget folders.
import { readdir, readFile, rm, stat } from "fs/promises";
import type { Dirent } from "fs";
import path from "path";

export interface BudgetMetadata {
  id?: string;
  groupId?: string;
  cloudFileId?: string;
  [key: string]: unknown;
}

export function actualDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ACTUAL_DATA_DIR || process.cwd();
}

export async function findLocalBudgetDir(syncId: string, { dataDir = actualDataDir() }: { dataDir?: string } = {}): Promise<{ budgetDir: string; metadata: BudgetMetadata } | null> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dataDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const budgetDir = path.join(dataDir, entry.name);
    let metadata: BudgetMetadata;
    try {
      metadata = JSON.parse(await readFile(path.join(budgetDir, "metadata.json"), "utf8")) as BudgetMetadata;
    } catch {
      continue;
    }
    if (metadata?.groupId === syncId && metadata?.id && metadata?.cloudFileId) {
      return { budgetDir, metadata };
    }
  }
  return null;
}

export async function pruneActualBudgetBackups(budgetDir: string, { keep = 1 }: { keep?: number } = {}): Promise<{ removed: number; kept: number }> {
  const backupDir = path.join(budgetDir, "backups");
  const keepCount = Math.max(0, Math.floor(Number(keep) || 0));
  let entries: Dirent[] = [];
  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch {
    return { removed: 0, kept: 0 };
  }

  const backups: Array<{ filePath: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) continue;
    const filePath = path.join(backupDir, entry.name);
    try {
      const fileStat = await stat(filePath);
      backups.push({ filePath, mtimeMs: fileStat.mtimeMs });
    } catch {
      // Ignore files that disappeared while pruning.
    }
  }

  backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = backups.slice(keepCount);
  await Promise.all(stale.map((backup) => rm(backup.filePath, { force: true })));
  return { removed: stale.length, kept: backups.length - stale.length };
}

export async function pruneLocalActualBackups({ dataDir = actualDataDir(), keep = 1 }: { dataDir?: string; keep?: number } = {}): Promise<{ removed: number; kept: number; budgets: number }> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dataDir, { withFileTypes: true });
  } catch {
    return { removed: 0, kept: 0, budgets: 0 };
  }

  let removed = 0;
  let kept = 0;
  let budgets = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const budgetDir = path.join(dataDir, entry.name);
    try {
      await readFile(path.join(budgetDir, "metadata.json"), "utf8");
    } catch {
      continue;
    }
    budgets += 1;
    const result = await pruneActualBudgetBackups(budgetDir, { keep });
    removed += result.removed;
    kept += result.kept;
  }
  return { removed, kept, budgets };
}

async function fileSizeBytes(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return null;
  }
}

async function summarizeBudgetBackups(budgetDir: string): Promise<{ backupCount: number; backupSizeBytes: number }> {
  const backupDir = path.join(budgetDir, "backups");
  let entries: Dirent[] = [];
  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch {
    return { backupCount: 0, backupSizeBytes: 0 };
  }

  let backupCount = 0;
  let backupSizeBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) continue;
    const size = await fileSizeBytes(path.join(backupDir, entry.name));
    backupCount += 1;
    backupSizeBytes += size || 0;
  }
  return { backupCount, backupSizeBytes };
}

export async function describeLocalActualBudget(budgetDir: string, { metadata = null }: { metadata?: BudgetMetadata | null } = {}) {
  let resolvedMetadata = metadata;
  if (!resolvedMetadata) {
    try {
      resolvedMetadata = JSON.parse(await readFile(path.join(budgetDir, "metadata.json"), "utf8")) as BudgetMetadata;
    } catch {
      resolvedMetadata = {};
    }
  }
  const [dbSizeBytes, backups] = await Promise.all([
    fileSizeBytes(path.join(budgetDir, "db.sqlite")),
    summarizeBudgetBackups(budgetDir),
  ]);
  return {
    budgetId: resolvedMetadata?.id || path.basename(budgetDir),
    syncId: resolvedMetadata?.groupId || null,
    cloudFileId: resolvedMetadata?.cloudFileId || null,
    budgetDir,
    actualDataDir: path.dirname(budgetDir),
    dbSizeBytes,
    ...backups,
  };
}
