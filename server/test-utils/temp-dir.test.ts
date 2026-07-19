import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupStaleTestArtifacts,
  createTestTempDir,
  getTestTempRoot,
  removeTempDir,
  validateTestTempRoot,
} from "./temp-dir.ts";

const createdDirs: string[] = [];

async function trackedTempDir(prefix: string): Promise<string> {
  const dir = await createTestTempDir(prefix);
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) await removeTempDir(dir);
});

describe("Setpoint test temp root", () => {
  it("resolves one exact Setpoint-owned child of the OS temp directory", () => {
    expect(getTestTempRoot()).toBe(path.resolve(os.tmpdir(), "setpoint-tests"));
  });

  it("refuses broad and unexpected cleanup roots", () => {
    expect(() => validateTestTempRoot(os.tmpdir())).toThrow(/Refusing unsafe test temp root/);
    expect(() => validateTestTempRoot(os.homedir())).toThrow(/Refusing unsafe test temp root/);
    expect(() => validateTestTempRoot(process.cwd())).toThrow(/Refusing unsafe test temp root/);
    expect(() => validateTestTempRoot(path.join(os.tmpdir(), "some-other-root")))
      .toThrow(/Refusing unsafe test temp root/);
  });

  it("creates artifacts only beneath the validated root", async () => {
    const dir = await trackedTempDir("contained-");
    expect(path.dirname(dir)).toBe(getTestTempRoot());
  });
});

describe("cleanupStaleTestArtifacts", () => {
  it("removes only age-qualified artifacts and reports the sweep", async () => {
    const oldDir = await trackedTempDir("cleanup-old-");
    const recentDir = await trackedTempDir("cleanup-recent-");
    const now = new Date("2026-07-18T12:00:00.000Z");
    const oldMtime = new Date("2026-07-16T00:00:00.000Z").getTime();

    const report = await cleanupStaleTestArtifacts({
      now: now.getTime(),
      getMtimeMs: async (entryPath) => entryPath === oldDir ? oldMtime : now.getTime(),
    });

    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(recentDir)).toBe(true);
    expect(report.removed).toBeGreaterThanOrEqual(1);
    expect(report.skippedRecent).toBeGreaterThanOrEqual(1);
  });

  it("tolerates a locked age-qualified artifact and leaves it for a later run", async () => {
    const lockedDir = await trackedTempDir("cleanup-locked-");
    const now = new Date("2026-07-18T12:00:00.000Z");
    const oldMtime = new Date("2026-07-16T00:00:00.000Z").getTime();
    const lockedError = Object.assign(new Error("locked"), { code: "EPERM" });

    const report = await cleanupStaleTestArtifacts({
      now: now.getTime(),
      getMtimeMs: async (entryPath) => entryPath === lockedDir ? oldMtime : now.getTime(),
      removeEntry: async () => { throw lockedError; },
    });

    expect(existsSync(lockedDir)).toBe(true);
    expect(report.locked).toBeGreaterThanOrEqual(1);
  });
});

describe("removeTempDir", () => {
  it("removes a plain contained temp dir", async () => {
    const dir = await trackedTempDir("plain-");
    await writeFile(path.join(dir, "x.txt"), "hi");
    await removeTempDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("refuses to remove the owned root itself or a path outside it", async () => {
    await expect(removeTempDir(getTestTempRoot())).rejects.toThrow(/Refusing unsafe test artifact path/);
    await expect(removeTempDir(os.tmpdir())).rejects.toThrow(/Refusing unsafe test artifact path/);
  });

  // Best-effort contract: deleting a dir whose libsql db file may still be
  // locked (Windows) must NOT throw or hang -- it leaves the dir for the next
  // age-gated stale sweep. On POSIX this still deletes immediately.
  it("does not throw when a just-closed libsql db may still be locked", async () => {
    const dir = await trackedTempDir("libsql-locked-");
    await mkdir(dir, { recursive: true });
    const db = createClient({ url: `file:${path.join(dir, "test.db")}` });
    await db.executeMultiple("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);");
    await db.close();
    await expect(removeTempDir(dir)).resolves.toBeUndefined();
  });

  it("is a no-op for a falsy path", async () => {
    await expect(removeTempDir(null)).resolves.toBeUndefined();
  });
});
