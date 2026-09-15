import "dotenv/config";
import { parseArgs } from "node:util";
import { acknowledgeEmailHistoryFailures } from "../email/email-history-acknowledgment.ts";

async function main() {
  const { values } = parseArgs({ options: {
    "job-ids": { type: "string" }, reason: { type: "string" },
    expect: { type: "string" }, apply: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log(`Usage: npm run email:acknowledge-history -- --job-ids 123,456 --reason "Reviewed historical failures; completeness unknown" [--apply --expect <preview revision>]

Requires EA_USER_ID and normal database configuration. Default is read-only.
Preview exact failed Gmail history jobs, then apply with the returned revision.
Acknowledgment accepts historical uncertainty; it does not claim recovery.
Original errors and payloads remain saved. No provider calls, retries, or mail changes.
Apply requires migration 079; production defaults require NODE_ENV=production.`);
    return;
  }
  const userId = process.env.EA_USER_ID?.trim();
  if (!userId) throw new Error("EA_USER_ID is required.");
  if (!values["job-ids"] || !/^\d+(,\d+)*$/.test(values["job-ids"])) throw new Error("--job-ids must be comma-separated exact numeric IDs.");
  if (!values.reason) throw new Error("--reason is required.");
  if (Boolean(values.apply) !== Boolean(values.expect)) throw new Error("Apply requires both --apply and --expect <preview revision>.");
  const { default: db } = await import("../db/connection.ts");
  const { resolveDatabaseClientConfig } = await import("../db/config.ts");
  try {
    const result = await acknowledgeEmailHistoryFailures({
      userId, jobIds: values["job-ids"].split(",").map(Number), reason: values.reason,
      expectedRevision: values.apply ? values.expect : undefined,
    }, { dbClient: db });
    console.log(JSON.stringify({ databaseMode: resolveDatabaseClientConfig().mode, ...result }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Email history acknowledgment failed.");
  process.exitCode = 1;
});
