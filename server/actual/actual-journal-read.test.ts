import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { it,expect } from 'vitest';
import { createTestTempDir,removeTempDir } from '../test-utils/temp-dir.ts';
import { readJournalRange } from './actual-journal-read.ts';

it('hydrates exact split and cross-date transfer relatives without adding them to date coverage',async()=>{
  const root=await createTestTempDir('actual-journal-');
  try {
    const dir=path.join(root,'Budget');await mkdir(dir);
    await writeFile(path.join(dir,'metadata.json'),JSON.stringify({id:'Budget',cloudFileId:'file',groupId:'sync'}));
    const db=createClient({url:`file:${path.join(dir,'db.sqlite')}`});
    await db.executeMultiple(`CREATE TABLE accounts(id TEXT,name TEXT);CREATE TABLE payees(id TEXT,name TEXT);CREATE TABLE categories(id TEXT,name TEXT);
      CREATE TABLE v_transactions(id TEXT,date INTEGER,amount INTEGER,payee TEXT,account TEXT,category TEXT,notes TEXT,schedule TEXT,transfer_id TEXT,parent_id TEXT,is_parent INTEGER,is_child INTEGER,cleared INTEGER,reconciled INTEGER,tombstone INTEGER);
      INSERT INTO accounts VALUES('a','Checking'),('b','Savings');INSERT INTO payees VALUES('p','Market');INSERT INTO categories VALUES('c','Groceries');
      INSERT INTO v_transactions VALUES
      ('parent',20260723,-3589,'p','a','c','','s',NULL,NULL,1,0,0,0,0),
      ('child1',20260723,-2762,'p','a','c','',NULL,NULL,'parent',0,1,0,0,0),
      ('child2',20260723,-827,'p','a','c','',NULL,NULL,'parent',0,1,0,0,0),
      ('sent',20260731,-10000,'p','a',NULL,'',NULL,'received',NULL,0,0,0,0,0),
      ('received',20260803,10000,'p','b',NULL,'',NULL,'sent',NULL,0,0,0,0,0);`);
    await db.close();
    const options={dataDir:root,localOnly:true,dbClient:{execute:async()=>({rows:[{actual_budget_url:'https://actual.example',actual_budget_sync_id:'sync'}]})}};
    const transfer=await readJournalRange('owner',{start:'2026-07-31',end:'2026-07-31'},options);
    expect(transfer.transactions.map(row=>row.id)).toEqual(['sent']);
    expect(transfer.relatives).toEqual([expect.objectContaining({id:'received',date:'2026-08-03',transferId:'sent',amountCents:10000})]);
    const split=await readJournalRange('owner',{start:'2026-07-23',end:'2026-07-23',limit:1,transactionId:'child1'},options);
    expect(split.truncated).toBe(true);
    expect([...split.transactions,...split.relatives].map(row=>row.id).sort()).toEqual(['child1','child2','parent']);
    expect([...split.transactions,...split.relatives].find(row=>row.id==='parent')).toMatchObject({amountCents:-3589,isParent:true,scheduleId:'s',cleared:false});
  } finally {await removeTempDir(root);}
});
