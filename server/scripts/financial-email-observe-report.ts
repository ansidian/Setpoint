import "dotenv/config";
import { createOwnerStore } from "../auth/owner-store.ts";
import { readFinancialEmailObserveReport } from "../bills/financial-email-observe-report.ts";

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 250;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new Error("Limit must be an integer from 1 to 1000.");
  }
  return parsed;
}

async function main(): Promise<void> {
  const owner = await createOwnerStore().getOwner();
  const userId = process.argv[2] || process.env.EA_USER_ID || owner?.userId;
  if (!userId) {
    throw new Error("No owner found. Pass a user id or set EA_USER_ID.");
  }
  const report = await readFinancialEmailObserveReport(userId, {
    limit: parseLimit(process.argv[3]),
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
