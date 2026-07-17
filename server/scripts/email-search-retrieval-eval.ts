import "dotenv/config";
import { readFile } from "fs/promises";
import db from "../db/connection.ts";
import { searchEmails } from "../email/email-service.ts";
import {
  createSyntheticEvalRetriever,
  evaluateRetrievalCases,
} from "../email/search/email-search-retrieval-eval.ts";
import { retrieveInboxAiSearch } from "../email/search/email-search-retrieval.ts";

const fixturePath = process.argv[2] || "server/email/search/evals/email-search-retrieval.synthetic.json";
const userId = process.argv[3] || process.env.EA_USER_ID || "eval-user";

type SyntheticRetriever = Awaited<ReturnType<typeof createSyntheticEvalRetriever>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const fixture: unknown = JSON.parse(await readFile(fixturePath, "utf8"));
  const fixtureRecord = isRecord(fixture) ? fixture : {};

  // A fixture that carries its own `corpus` is self-contained: seed it into an
  // in-memory DB and run deterministically (CI-safe). Otherwise fall back to the
  // legacy path that scores expected UIDs against the real dev DB (the local
  // fixture built from `email-search:eval:seed`).
  let retrieve: SyntheticRetriever["retrieve"];
  let retrieveInbox: SyntheticRetriever["retrieveInbox"];
  let cleanup: SyntheticRetriever["cleanup"] = async () => {};
  if (Array.isArray(fixtureRecord.corpus) && fixtureRecord.corpus.length) {
    ({ retrieve, retrieveInbox, cleanup } = await createSyntheticEvalRetriever(fixture));
  } else {
    retrieve = (evalUserId: string, options: { q: string; limit: number }) => retrieveInboxAiSearch(evalUserId, {
      ...options,
      dbClient: db,
    });
    retrieveInbox = async (evalUserId: string, options: { q: string; limit: number }) => {
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

main().catch((err: unknown) => {
  console.error("[Email Search Retrieval Eval] Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
