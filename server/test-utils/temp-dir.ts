// Shared test-only filesystem isolation for real libsql/SQLite/Actual fixtures.
//
// Every artifact lives beneath one exact Setpoint-owned child of the OS temp
// directory. Windows can retain libsql file locks after close(), so same-run
// removal is best-effort and the next run sweeps only entries older than the
// safety window. Cleanup never targets the OS temp directory, home, workspace,
// or the owned root itself.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const TEST_TEMP_ROOT_NAME = "setpoint-tests";
export const STALE_ARTIFACT_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_STALE_ARTIFACTS_PER_SWEEP = 100;

const TRANSIENT = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);
const MISSING = new Set(["ENOENT"]);

interface CleanupOptions {
  root?: string;
  now?: number;
  staleAfterMs?: number;
  maxArtifacts?: number;
  getMtimeMs?: (entryPath: string) => Promise<number>;
  removeEntry?: typeof rm;
}

export interface TempCleanupReport {
  root: string;
  scanned: number;
  eligible: number;
  attempted: number;
  removed: number;
  locked: number;
  skippedRecent: number;
  deferredByLimit: number;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function errorCodeIs(error: unknown, codes: ReadonlySet<string>): boolean {
  return isErrnoException(error) && typeof error.code === "string" && codes.has(error.code);
}

export function validateTestTempRoot(
  candidate: string,
  tempDirectory = os.tmpdir(),
): string {
  const resolvedTempDirectory = path.resolve(tempDirectory);
  const resolvedCandidate = path.resolve(candidate);
  const expectedRoot = path.resolve(resolvedTempDirectory, TEST_TEMP_ROOT_NAME);
  const forbiddenRoots = new Set([
    path.parse(resolvedCandidate).root,
    resolvedTempDirectory,
    path.resolve(os.homedir()),
    path.resolve(process.cwd()),
  ]);

  if (resolvedCandidate !== expectedRoot || forbiddenRoots.has(resolvedCandidate)) {
    throw new Error(`Refusing unsafe test temp root: ${resolvedCandidate}`);
  }

  return resolvedCandidate;
}

export function getTestTempRoot(tempDirectory = os.tmpdir()): string {
  return validateTestTempRoot(
    path.resolve(tempDirectory, TEST_TEMP_ROOT_NAME),
    tempDirectory,
  );
}

function validateTestArtifactPath(candidate: string, root = getTestTempRoot()): string {
  const validatedRoot = validateTestTempRoot(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(validatedRoot, resolvedCandidate);

  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`Refusing unsafe test artifact path: ${resolvedCandidate}`);
  }

  return resolvedCandidate;
}

function validatePrefix(prefix: string): void {
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(prefix)) {
    throw new Error(`Invalid test temp prefix: ${prefix}`);
  }
}

async function removeEntryBestEffort(
  entryPath: string,
  removeEntry: typeof rm,
): Promise<"removed" | "locked"> {
  try {
    await removeEntry(entryPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    return "removed";
  } catch (error: unknown) {
    if (errorCodeIs(error, TRANSIENT)) return "locked";
    if (errorCodeIs(error, MISSING)) return "removed";
    throw error;
  }
}

export async function cleanupStaleTestArtifacts(
  options: CleanupOptions = {},
): Promise<TempCleanupReport> {
  const root = validateTestTempRoot(options.root ?? getTestTempRoot());
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? STALE_ARTIFACT_AGE_MS;
  const maxArtifacts = options.maxArtifacts ?? MAX_STALE_ARTIFACTS_PER_SWEEP;
  const getMtimeMs = options.getMtimeMs ?? (async (entryPath: string) => (await lstat(entryPath)).mtimeMs);
  const removeEntry = options.removeEntry ?? rm;

  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new Error("staleAfterMs must be a non-negative finite number");
  }
  if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1) {
    throw new Error("maxArtifacts must be a positive integer");
  }

  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const agedEntries: Array<{ path: string; mtimeMs: number }> = [];
  let skippedRecent = 0;

  for (const entry of entries) {
    const entryPath = validateTestArtifactPath(path.join(root, entry.name), root);
    try {
      const mtimeMs = await getMtimeMs(entryPath);
      if (mtimeMs <= now - staleAfterMs) agedEntries.push({ path: entryPath, mtimeMs });
      else skippedRecent += 1;
    } catch (error: unknown) {
      if (!errorCodeIs(error, MISSING)) throw error;
    }
  }

  agedEntries.sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
  const candidates = agedEntries.slice(0, maxArtifacts);
  let removed = 0;
  let locked = 0;

  for (const candidate of candidates) {
    const result = await removeEntryBestEffort(candidate.path, removeEntry);
    if (result === "removed") removed += 1;
    else locked += 1;
  }

  return {
    root,
    scanned: entries.length,
    eligible: agedEntries.length,
    attempted: candidates.length,
    removed,
    locked,
    skippedRecent,
    deferredByLimit: Math.max(0, agedEntries.length - candidates.length),
  };
}

let defaultCleanup: Promise<TempCleanupReport> | null = null;

function startDefaultCleanup(): Promise<TempCleanupReport> {
  defaultCleanup ??= cleanupStaleTestArtifacts();
  return defaultCleanup;
}

export async function createTestTempDir(prefix: string): Promise<string> {
  validatePrefix(prefix);
  const root = getTestTempRoot();
  await startDefaultCleanup();
  return mkdtemp(path.join(root, prefix));
}

export function createTestTempDirSync(prefix: string): string {
  validatePrefix(prefix);
  const root = getTestTempRoot();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, prefix));
}

export async function removeTempDir(dir: string | null | undefined): Promise<void> {
  if (!dir) return;
  const artifactPath = validateTestArtifactPath(dir);
  await removeEntryBestEffort(artifactPath, rm);
}

export function removeTempDirSync(dir: string | null | undefined): void {
  if (!dir) return;
  const artifactPath = validateTestArtifactPath(dir);
  try {
    rmSync(artifactPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (error: unknown) {
    if (!errorCodeIs(error, TRANSIENT) && !errorCodeIs(error, MISSING)) throw error;
  }
}
