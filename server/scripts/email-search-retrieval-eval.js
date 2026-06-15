import "dotenv/config";
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import db from "../db/connection.js";
import {
  createSyntheticEvalRetriever,
  evaluateRetrievalCases,
} from "../email/search/email-search-retrieval-eval.js";
import { retrieveInboxAiSearch } from "../email/search/email-search-retrieval.js";

const fixturePath = process.argv[2] || "server/email/search/evals/email-search-retrieval.synthetic.json";
const userId = process.argv[3] || process.env.EA_USER_ID || "eval-user";

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

  // A fixture that carries its own `corpus` is self-contained: seed it into an
  // in-memory DB and run deterministically (CI-safe). Otherwise fall back to the
  // legacy path that scores expected UIDs against the real dev DB (the local
  // fixture built from `email-search:eval:seed`).
  let retrieve;
  let cleanup = () => {};
  if (Array.isArray(fixture.corpus) && fixture.corpus.length) {
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
    ({ retrieve, cleanup } = await createSyntheticEvalRetriever(fixture, { migrationsDir }));
  } else {
    retrieve = (evalUserId, options) => retrieveInboxAiSearch(evalUserId, {
      ...options,
      dbClient: db,
    });
  }

  try {
    const report = await evaluateRetrievalCases(fixture, { userId, retrieve });
    console.log(JSON.stringify(report, null, 2));
    if (report.failed) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error("[Email Search Retrieval Eval] Failed:", err.message);
  process.exit(1);
});
