import { mkdtemp, writeFile } from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { removeTempDir } from "./temp-dir.ts";

describe("removeTempDir", () => {
  it("removes a plain temp dir", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "temp-dir-plain-"));
    await writeFile(path.join(dir, "x.txt"), "hi");
    await removeTempDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  // Best-effort contract: deleting a dir whose libsql db file may still be
  // locked (Windows) must NOT throw or hang -- it leaves the dir for the OS to
  // reclaim. On POSIX this still deletes immediately.
  it("does not throw when a just-closed libsql db may still be locked", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "temp-dir-locked-"));
    const db = createClient({ url: `file:${path.join(dir, "test.db")}` });
    await db.executeMultiple("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);");
    await db.close();
    await expect(removeTempDir(dir)).resolves.toBeUndefined();
  });

  it("is a no-op for a falsy path", async () => {
    await expect(removeTempDir(null)).resolves.toBeUndefined();
  });
});
