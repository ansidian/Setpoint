import 'dotenv/config';
import db from '../db/connection.ts';
import { activateFinancialProviderEpoch } from '../financial-events/financial-provider-policy.ts';

async function main() {
  const [flag, revisionValue] = process.argv.slice(2);
  const revision = Number(revisionValue);
  if (flag !== '--revision' || !Number.isSafeInteger(revision) || revision < 1 || !process.env.EA_USER_ID) {
    throw new Error('Usage: EA_USER_ID=<owner> node server/scripts/activate-financial-provider-parsers.ts --revision <verified migrated revision>. Stop workers first. Activation preserves all historical data and cannot be reset.');
  }
  const cutoff = await activateFinancialProviderEpoch(process.env.EA_USER_ID, revision);
  console.log(JSON.stringify({providerParserCutoverAt: cutoff}));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }).finally(() => db.close());
