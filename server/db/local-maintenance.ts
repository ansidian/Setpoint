import { createClient, type Client } from "@libsql/client";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

/** Fail rather than silently degrade semantic search on a different local engine. */
export async function assertNativeVectorSupport(client: Client): Promise<void> {
  const result = await client.execute("SELECT vector_distance_cos(vector32('[1,0]'), vector32('[1,0]')) AS distance");
  if (Number(result.rows[0]?.distance) !== 0) throw new Error("Local database native vector search is unavailable");
}

export async function inspectLocalDatabase(client: Client) {
  const integrity = await client.execute("PRAGMA integrity_check");
  if (integrity.rows.length !== 1 || Object.values(integrity.rows[0]!)[0] !== "ok") {
    throw new Error("Database integrity check failed");
  }
  const foreignKeys = await client.execute("PRAGMA foreign_key_check");
  if (foreignKeys.rows.length) throw new Error(`Database has ${foreignKeys.rows.length} foreign-key violations`);
  await assertNativeVectorSupport(client);
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const counts: Record<string, number> = {};
  for (const row of tables.rows) {
    const name = String(row.name);
    const result = await client.execute(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`);
    counts[name] = Number(result.rows[0]?.n);
  }
  return { integrity: "ok", foreignKeys: "ok", nativeVectors: true, counts };
}

/** SQLite's VACUUM INTO produces a transactionally consistent standalone file. */
export async function snapshotLocalDatabase(client: Client, destination: string) {
  if (!isAbsolute(destination)) throw new Error("Snapshot path must be absolute");
  try {
    await stat(destination);
    throw new Error("Snapshot destination already exists");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await client.execute({ sql: "VACUUM INTO ?", args: [destination] });
  const snapshot = createClient({ url: pathToFileURL(destination).href });
  try { return await inspectLocalDatabase(snapshot); } finally { snapshot.close(); }
}
