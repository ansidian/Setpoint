import { mkdir, readdir, writeFile, utimes } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import {
  actualDataDir,
  describeLocalActualBudget,
  findLocalBudgetDir,
  pruneActualBudgetBackups,
  pruneLocalActualBackups,
} from "./actualMetadataCacheStore.ts";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await removeTempDir(tempDir);
  tempDir = null;
});

async function writeBudget(budgetDir: string, { id = "Budget-1", cloudFileId = "file-1", groupId = "sync-123" } = {}) {
  await mkdir(budgetDir, { recursive: true });
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({ id, cloudFileId, groupId }));
}

describe("actualDataDir", () => {
  it("prefers ACTUAL_DATA_DIR and falls back to cwd", () => {
    expect(actualDataDir({ ACTUAL_DATA_DIR: "/tmp/custom" })).toBe("/tmp/custom");
    expect(actualDataDir({})).toBe(process.cwd());
  });
});

describe("findLocalBudgetDir", () => {
  it("locates the budget folder whose metadata matches the sync id", async () => {
    tempDir = await createTestTempDir("actual-store-");
    await writeBudget(path.join(tempDir, "Budget-1"), { groupId: "sync-123" });
    await writeBudget(path.join(tempDir, "Budget-Other"), { id: "Other", groupId: "sync-other" });

    const found = await findLocalBudgetDir("sync-123", { dataDir: tempDir });

    expect(found?.budgetDir).toBe(path.join(tempDir, "Budget-1"));
    expect(found?.metadata).toMatchObject({ id: "Budget-1", groupId: "sync-123" });
  });

  it("returns null when no budget matches and tolerates a missing data dir", async () => {
    tempDir = await createTestTempDir("actual-store-");
    await expect(findLocalBudgetDir("missing", { dataDir: tempDir })).resolves.toBeNull();
    await expect(findLocalBudgetDir("missing", { dataDir: path.join(tempDir, "nope") })).resolves.toBeNull();
  });
});

describe("pruneActualBudgetBackups", () => {
  it("keeps only the newest zip backup and ignores non-zip files", async () => {
    tempDir = await createTestTempDir("actual-store-");
    const backupDir = path.join(tempDir, "Budget-1", "backups");
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, "old.zip"), "old");
    await writeFile(path.join(backupDir, "new.zip"), "new");
    await writeFile(path.join(backupDir, "db.latest.sqlite"), "latest");
    await utimes(path.join(backupDir, "old.zip"), new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));
    await utimes(path.join(backupDir, "new.zip"), new Date("2026-05-02T00:00:00Z"), new Date("2026-05-02T00:00:00Z"));

    const result = await pruneActualBudgetBackups(path.join(tempDir, "Budget-1"), { keep: 1 });

    expect(result).toEqual({ removed: 1, kept: 1 });
    await expect(readdir(backupDir).then((files) => files.sort())).resolves.toEqual([
      "db.latest.sqlite",
      "new.zip",
    ]);
  });

  it("returns a zero result when there is no backups directory", async () => {
    tempDir = await createTestTempDir("actual-store-");
    await expect(pruneActualBudgetBackups(path.join(tempDir, "Budget-1"))).resolves.toEqual({ removed: 0, kept: 0 });
  });
});

describe("pruneLocalActualBackups", () => {
  it("prunes backups across budget folders and skips non-budget directories", async () => {
    tempDir = await createTestTempDir("actual-store-");
    const budgetDir = path.join(tempDir, "My-Finances");
    const backupDir = path.join(budgetDir, "backups");
    await writeBudget(budgetDir);
    await mkdir(backupDir, { recursive: true });
    await mkdir(path.join(tempDir, "not-a-budget", "backups"), { recursive: true });
    await writeFile(path.join(backupDir, "old.zip"), "old");
    await writeFile(path.join(backupDir, "new.zip"), "new");
    await utimes(path.join(backupDir, "old.zip"), new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));
    await utimes(path.join(backupDir, "new.zip"), new Date("2026-05-02T00:00:00Z"), new Date("2026-05-02T00:00:00Z"));

    const result = await pruneLocalActualBackups({ dataDir: tempDir, keep: 1 });

    expect(result).toEqual({ removed: 1, kept: 1, budgets: 1 });
    await expect(readdir(backupDir).then((files) => files.sort())).resolves.toEqual(["new.zip"]);
  });
});

describe("describeLocalActualBudget", () => {
  it("summarizes db size, backups, and metadata-derived ids", async () => {
    tempDir = await createTestTempDir("actual-store-");
    const budgetDir = path.join(tempDir, "Budget-1");
    const backupDir = path.join(budgetDir, "backups");
    await writeBudget(budgetDir, { id: "Budget-1", cloudFileId: "file-1", groupId: "sync-123" });
    await writeFile(path.join(budgetDir, "db.sqlite"), "0123456789");
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, "latest.zip"), "backup");

    const summary = await describeLocalActualBudget(budgetDir);

    expect(summary).toMatchObject({
      budgetId: "Budget-1",
      syncId: "sync-123",
      cloudFileId: "file-1",
      budgetDir,
      actualDataDir: tempDir,
      dbSizeBytes: 10,
      backupCount: 1,
      backupSizeBytes: 6,
    });
  });

  it("falls back to the directory basename when metadata is unreadable", async () => {
    tempDir = await createTestTempDir("actual-store-");
    const budgetDir = path.join(tempDir, "Orphan-Budget");
    await mkdir(budgetDir, { recursive: true });

    const summary = await describeLocalActualBudget(budgetDir);

    expect(summary).toMatchObject({
      budgetId: "Orphan-Budget",
      syncId: null,
      cloudFileId: null,
      dbSizeBytes: null,
      backupCount: 0,
      backupSizeBytes: 0,
    });
  });
});
