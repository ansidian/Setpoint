import "dotenv/config";
import { readFile } from "fs/promises";
import { answerInboxAiSearch } from "../briefing/email-search-answer.js";
import { evaluateAnswerCases } from "../briefing/email-search-answer-eval.js";

const fixturePath = process.argv[2] || "server/briefing/evals/email-search-answer.synthetic.json";
const userId = process.argv[3] || process.env.EA_USER_ID || "eval-user";

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const report = await evaluateAnswerCases(fixture, {
    userId,
    answer: (evalUserId, options) => answerInboxAiSearch(evalUserId, options),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[Email Search Answer Eval] Failed:", err.message);
  process.exit(1);
});
