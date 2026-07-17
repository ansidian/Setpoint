import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface MigrationManifest {
  remainingLegacyFiles: number;
  typedScopes: string[];
}

interface MigrationCheckOptions {
  cwd: string;
  manifestPath?: string;
}

export interface MigrationCheckResult {
  legacyFileCount: number;
  legacyFiles: string[];
}

const OWNED_ROOTS = ["src/", "server/", "shared/", "scripts/", "e2e/"];
const OWNED_ROOT_CONFIGS = new Set([
  "eslint.config.js",
  "playwright.config.js",
  "vite.config.js",
  "vitest.config.js",
]);
const LEGACY_EXTENSION = /\.(?:js|jsx|mjs|cjs)$/;

function isMigrationManifest(value: unknown): value is MigrationManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Number.isInteger(candidate.remainingLegacyFiles)
    && typeof candidate.remainingLegacyFiles === "number"
    && candidate.remainingLegacyFiles >= 0
    && Array.isArray(candidate.typedScopes)
    && candidate.typedScopes.every((scope) => typeof scope === "string" && scope.length > 0);
}

function readManifest(path: string): MigrationManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isMigrationManifest(parsed)) {
    throw new Error(`Invalid TypeScript migration manifest: ${path}`);
  }
  return parsed;
}

function isOwnedPath(path: string) {
  return OWNED_ROOT_CONFIGS.has(path) || OWNED_ROOTS.some((root) => path.startsWith(root));
}

function isWithinScope(path: string, scope: string) {
  const normalizedScope = scope.replace(/^\.\//, "").replace(/\/$/, "");
  return path === normalizedScope || path.startsWith(`${normalizedScope}/`);
}

export function checkTypescriptMigration({
  cwd,
  manifestPath = "scripts/typescript-migration-manifest.json",
}: MigrationCheckOptions): MigrationCheckResult {
  const manifest = readManifest(resolve(cwd, manifestPath));
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const legacyFiles = trackedFiles.filter((path) => isOwnedPath(path) && LEGACY_EXTENSION.test(path));
  const errors: string[] = [];

  if (legacyFiles.length !== manifest.remainingLegacyFiles) {
    const displayedFiles = legacyFiles.slice(0, 20).map((path) => `  - ${path}`);
    if (legacyFiles.length > displayedFiles.length) {
      displayedFiles.push(`  - …and ${legacyFiles.length - displayedFiles.length} more`);
    }
    errors.push(
      `Legacy file count mismatch: manifest expects ${manifest.remainingLegacyFiles}, found ${legacyFiles.length}.\nTracked legacy files:\n${displayedFiles.join("\n")}`,
    );
  }

  for (const scope of manifest.typedScopes) {
    const scopedFiles = trackedFiles.filter((path) => isWithinScope(path, scope));
    if (scopedFiles.length === 0 && !existsSync(resolve(cwd, scope))) {
      errors.push(`Typed scope does not match any tracked files or working-tree path: ${scope}`);
      continue;
    }
    const scopedLegacyFiles = scopedFiles.filter((path) => LEGACY_EXTENSION.test(path));
    if (scopedLegacyFiles.length > 0) {
      errors.push(`Typed scope "${scope}" contains legacy files:\n${scopedLegacyFiles.map((path) => `  - ${path}`).join("\n")}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
  return { legacyFileCount: legacyFiles.length, legacyFiles };
}

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const result = checkTypescriptMigration({ cwd: process.cwd() });
    console.log(`TypeScript migration check passed: ${result.legacyFileCount} legacy files remain.`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
