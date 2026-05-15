import { pruneLocalActualBackups } from "../briefing/actual-local-metadata.js";

const keepArg = process.argv.find((arg) => arg.startsWith("--keep="));
const keep = keepArg ? Number(keepArg.slice("--keep=".length)) : 1;

const result = await pruneLocalActualBackups({ keep });
console.log(JSON.stringify({
  actualDataDir: process.env.ACTUAL_DATA_DIR || process.cwd(),
  keep,
  ...result,
}, null, 2));
