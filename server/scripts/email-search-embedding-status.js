import "dotenv/config";
import { detectEmailSearchVectorCapability } from "../email/search/email-search-embedding-store.ts";
import { getEmailSearchEmbeddingCoverageStatus } from "../email/search/email-search-embedding-worker.ts";
import {
  createEmailSearchHarnessDb,
  parseEmailSearchHarnessArgs,
  requireHarnessUserId,
} from "../email/search/email-search-dev-harness.ts";

async function main() {
  const options = parseEmailSearchHarnessArgs(process.argv.slice(2), { command: "status" });
  const userId = requireHarnessUserId(options.userId);
  const { config, dbClient } = createEmailSearchHarnessDb(options);
  try {
    const capability = await detectEmailSearchVectorCapability(dbClient);
    const status = await getEmailSearchEmbeddingCoverageStatus(userId, {
      dbClient,
      capability,
    });
    const payload = {
      adapter: options.adapter,
      database_mode: config.mode,
      vector_capability: capability,
      user_id: userId,
      ...status,
    };
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await dbClient.close?.();
  }
}

main().catch((err) => {
  console.error(`[EA] Email search embedding status failed: ${err.message}`);
  process.exitCode = 1;
});
