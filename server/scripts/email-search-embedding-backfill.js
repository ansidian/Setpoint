import "dotenv/config";
import { detectEmailSearchVectorCapability } from "../email/search/email-search-embedding-store.ts";
import { processEmailSearchEmbeddingBatch } from "../email/search/email-search-embedding-worker.ts";
import {
  createEmailSearchHarnessDb,
  parseEmailSearchHarnessArgs,
  requireHarnessUserId,
} from "../email/search/email-search-dev-harness.ts";

async function main() {
  const options = parseEmailSearchHarnessArgs(process.argv.slice(2), { command: "backfill" });
  const userId = requireHarnessUserId(options.userId);
  const { config, dbClient } = createEmailSearchHarnessDb(options);
  try {
    const capability = await detectEmailSearchVectorCapability(dbClient);
    const result = await processEmailSearchEmbeddingBatch(userId, {
      dbClient,
      capability,
      limit: options.limit,
      batchSize: options.batchSize,
    });
    const payload = {
      adapter: options.adapter,
      database_mode: config.mode,
      vector_capability: capability,
      user_id: userId,
      limit: options.limit,
      batch_size: options.batchSize,
      ...result,
    };
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await dbClient.close?.();
  }
}

main().catch((err) => {
  console.error(`[EA] Email search embedding backfill failed: ${err.message}`);
  process.exitCode = 1;
});
