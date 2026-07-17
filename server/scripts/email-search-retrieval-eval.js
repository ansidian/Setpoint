import "dotenv/config";
import { readFile } from "fs/promises";
import db from "../db/connection.ts";
import { searchEmails } from "../email/email-service.js";
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
  let retrieveInbox;
  let cleanup = () => {};
  if (Array.isArray(fixture.corpus) && fixture.corpus.length) {
    ({ retrieve, retrieveInbox, cleanup } = await createSyntheticEvalRetriever(fixture));
  } else {
    retrieve = (evalUserId, options) => retrieveInboxAiSearch(evalUserId, {
      ...options,
      dbClient: db,
    });
    retrieveInbox = async (evalUserId, options) => {
      const { results } = await searchEmails(evalUserId, { ...options, dbClient: db });
      return { candidates: results.map((r) => ({ uid: r.uid })) };
    };
  }

  try {
    const report = await evaluateRetrievalCases(fixture, { userId, retrieve, retrieveInbox });
    console.log(JSON.stringify(report, null, 2));
    if (report.mrr != null) console.log(`MRR: ${report.mrr.toFixed(3)}`);
    if (report.inbox_mrr != null) console.log(`Inbox MRR: ${report.inbox_mrr.toFixed(3)}`);
    if (report.failed) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error("[Email Search Retrieval Eval] Failed:", err.message);
  process.exit(1);
});
