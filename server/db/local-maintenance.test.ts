import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotLocalDatabase } from "./local-maintenance.ts";

describe("local database snapshots", () => {
  it("preserves committed WAL data, full-text matches and native vectors in a standalone backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "setpoint-backup-"));
    const source = createClient({ url: `file:${dir}/source.db` });
    try {
      await source.execute("PRAGMA journal_mode=WAL");
      await source.execute("CREATE TABLE documents (id INTEGER PRIMARY KEY, embedding F32_BLOB(2))");
      await source.execute("CREATE VIRTUAL TABLE search USING fts5(body)");
      await source.execute("INSERT INTO documents VALUES (1, vector32('[1,0]'))");
      await source.execute("INSERT INTO search VALUES ('fictional verification message')");
      const target = join(dir, "snapshot.db");
      const report = await snapshotLocalDatabase(source, target);
      expect(report.counts.documents).toBe(1);
      await source.execute("INSERT INTO documents VALUES (2, vector32('[0,1]'))");
      const copy = createClient({ url: `file:${target}` });
      try {
        expect((await copy.execute("SELECT count(*) n FROM documents")).rows[0]?.n).toBe(1);
        expect((await copy.execute("SELECT count(*) n FROM search WHERE search MATCH 'verification'")).rows[0]?.n).toBe(1);
        expect((await copy.execute("SELECT vector_distance_cos(embedding, vector32('[1,0]')) distance FROM documents")).rows[0]?.distance).toBe(0);
      } finally { copy.close(); }
      await expect(snapshotLocalDatabase(source, target)).rejects.toThrow(/already exists/);
    } finally { source.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
