import 'dotenv/config';
import { previewFinancialConnectionMigration, applyFinancialConnectionMigration } from '../financial-connections/migration.ts';
import db from '../db/connection.ts';

async function main() {
  const args=process.argv.slice(2);
  if(args.includes('--help')) {
    console.log('Usage: node --experimental-strip-types server/scripts/migrate-financial-connections.ts [--apply --fingerprint <preview fingerprint>]\nDefault is a read-only preview. Apply changes owner configuration only, never Actual data or parser activation. Requires EA_USER_ID and configured database.');
    return;
  }
  let apply=false;let fingerprint='';
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--apply') apply=true;
    else if(args[i]==='--fingerprint') fingerprint=args[++i] || '';
    else throw new Error('Unknown argument. Use --help.');
  }
  const owner=process.env.EA_USER_ID;if(!owner) throw new Error('EA_USER_ID is required.');
  if(apply && !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Apply requires the exact preview fingerprint.');
  const result=apply ? await applyFinancialConnectionMigration(owner,fingerprint) : await previewFinancialConnectionMigration(owner);
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error instanceof Error ? error.message : error);process.exitCode=1;}).finally(()=>db.close());
