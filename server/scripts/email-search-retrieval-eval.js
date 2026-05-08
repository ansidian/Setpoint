import "dotenv/config";
import { readFile } from "fs/promises";
import db from "../db/connection.js";
import { evaluateRetrievalCases } from "../briefing/email-search-retrieval-eval.js";
import { retrieveInboxAiSearch } from "../briefing/email-search-retrieval.js";

const fixturePath = process.argv[2] || "server/briefing/evals/email-search-retrieval.synthetic.json";
const userId = process.argv[3] || process.env.EA_USER_ID || "eval-user";

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const report = await evaluateRetrievalCases(fixture, {
    userId,
    retrieve: (evalUserId, options) => retrieveInboxAiSearch(evalUserId, {
      ...options,
      dbClient: db,
    }),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[Email Search Retrieval Eval] Failed:", err.message);
  process.exit(1);
});
