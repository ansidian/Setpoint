/** Offline local database inspection/snapshot. Never imports app startup or workers. */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { resolveDatabaseClientConfig } from "../db/config.ts";
import { inspectLocalDatabase, snapshotLocalDatabase } from "../db/local-maintenance.ts";

const config = resolveDatabaseClientConfig(process.env);
if (config.adapter !== "sqlite") throw new Error("This command only accepts a local database");
const client = createClient(config.client);
try {
  const command = process.argv[2];
  if (command === "snapshot") {
    const destination = process.argv[3];
    if (!destination) throw new Error("Usage: local-db.ts snapshot /absolute/new-snapshot.db");
    process.umask(0o077);
    const report = await snapshotLocalDatabase(client, destination);
    await chmod(destination, 0o600);
    console.log(JSON.stringify(report));
  } else if (command === "audit") {
    const report = await inspectLocalDatabase(client);
    // Import credential machinery only after establishing the intended local DB.
    const { createRootKeyHealthService } = await import("../platform/root-key-health.ts");
    const key = await createRootKeyHealthService({ dbClient: client }).getMetadata();
    if (key.decryptability !== "ok") throw new Error("Local credential decryptability check failed");
    const hashes = new Set<string>();
    if (report.counts.ea_tldraw_documents) {
      const documents = await client.execute("SELECT document_gzip FROM ea_tldraw_documents");
      for (const row of documents.rows) {
        if (!(row.document_gzip instanceof ArrayBuffer)) throw new Error("Invalid Notes document blob");
        const doc = gunzipSync(Buffer.from(row.document_gzip)).toString("utf8");
        for (const match of doc.matchAll(/\/api\/tldraw\/assets\/([a-f0-9]{64})/g)) hashes.add(match[1]!);
      }
    }
    for (const hash of hashes) {
      const root = process.env.EA_TLDRAW_ASSET_DIR;
      if (!root) throw new Error("Notes assets exist but EA_TLDRAW_ASSET_DIR is missing");
      const bytes = await readFile(join(root, `${hash}.bin`));
      const metadata = JSON.parse(await readFile(join(root, `${hash}.json`), "utf8")) as { hash?: string; size?: number };
      if (createHash("sha256").update(bytes).digest("hex") !== hash || metadata.hash !== hash || metadata.size !== bytes.length) {
        throw new Error("Notes asset integrity check failed");
      }
    }
    console.log(JSON.stringify({ ...report, decryptability: "ok", notesAssets: hashes.size }));
  } else {
    throw new Error("Usage: local-db.ts audit | snapshot /absolute/new-snapshot.db");
  }
} finally {
  client.close();
  // The credential service module owns a separate lazy default connection.
  const { default: defaultDb } = await import("../db/connection.ts");
  defaultDb.close();
}
