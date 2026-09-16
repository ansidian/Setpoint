import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { createTestTempDir, removeTempDir } from '../test-utils/temp-dir.ts';
import { readFileSync } from 'node:fs';
import { previewFinancialConnectionMigration, applyFinancialConnectionMigration } from './migration.ts';
import { readFinancialConnections, saveFinancialConnections } from './service.ts';
import { readFinancialProfiles } from '../bills/financial-profiles.ts';
import { connectionPayLinks, readConfiguredUtilities } from './storage.ts';
import { updateUtilityMapping } from '../finances/utility-mappings.ts';

let dbClient:Client;
let tempDir:string;
const utilityProfile={id:'sce-profile',name:'SCE',enabled:true,budgetId:'budget',senderAddresses:['sce@message.sce.com'],target:{kind:'utility',scheduleId:'sce-schedule'}};
const cardProfile={id:'citi-profile',name:'Citi Costco',enabled:true,budgetId:'budget',senderAddresses:['alerts@info6.citi.com'],accountLast4:'1234',target:{kind:'card_payment',fromAccountId:'checking',toAccountId:'citi'}};
beforeEach(async()=>{
  tempDir=await createTestTempDir('financial-connections-');
  dbClient=createClient({url:`file:${tempDir}/db.sqlite`});
  await dbClient.executeMultiple(`CREATE TABLE ea_settings (user_id TEXT PRIMARY KEY, actual_budget_sync_id TEXT, financial_profiles_json TEXT, financial_profiles_revision INTEGER DEFAULT 0,utility_pay_links_json TEXT);`);
  for(const file of ['009_actual_metadata_mirror.sql','065_finance_utilities.sql','080_financial_connections.sql']) await dbClient.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
  await dbClient.execute({sql:'INSERT INTO ea_settings VALUES (?,?,?,?,?)',args:['owner','budget',JSON.stringify([utilityProfile,cardProfile]),7,JSON.stringify([{scheduleId:'sce-schedule',label:'Electricity',url:'https://sce.example/pay'}])]});
  await dbClient.execute({sql:'INSERT INTO ea_finance_utilities VALUES (?,?,?,?,?,?,?,?,?)',args:['owner','budget','electricity','Electricity','SCE','sce',JSON.stringify(['sce-schedule']),JSON.stringify(['sce@message.sce.com','donotreply@email.sce.com']),'']});
  await dbClient.execute({sql:"INSERT INTO ea_actual_metadata_mirror (user_id,status,accounts_json,payees_json,schedules_json) VALUES ('owner','current',?,?,?)",args:[JSON.stringify([{id:'checking',name:'Checking'},{id:'citi',name:'Citi'}]),JSON.stringify([{id:'sce',name:'SCE'}]),JSON.stringify([{id:'sce-schedule',name:'SCE',type:'bill',conditions:[{field:'account',op:'is',value:'checking'},{field:'payee',op:'is',value:'sce'}]}])]});
});
afterEach(async()=>{dbClient.close();await removeTempDir(tempDir);});
async function migrate() {const preview=await previewFinancialConnectionMigration('owner',dbClient);return applyFinancialConnectionMigration('owner',preview.fingerprint,{dbClient});}

describe('canonical financial provider configuration',()=>{
  it('previews without writes, migrates atomically and preserves identities, targets and archived settings',async()=>{
    const before=await readFinancialConnections('owner',{dbClient});
    expect(before).toMatchObject({migrated:false,revision:7,connections:[{id:'sce-profile',providerId:'sce',enabled:true,utility:{id:'electricity'},payLink:'https://sce.example/pay'},{id:'citi-profile',providerId:'citi',enabled:true,accountLast4:'1234'}]});
    expect((await dbClient.execute('SELECT * FROM ea_financial_connections')).rows).toEqual([]);
    await migrate();
    const after=await readFinancialConnections('owner',{dbClient});
    expect(after).toEqual({...before,migrated:true,revision:8});
    expect((await readFinancialProfiles('owner',{dbClient})).profiles[1]).toMatchObject({id:'citi-profile',senderAddresses:expect.arrayContaining(['citicards@info6.citi.com']),target:cardProfile.target});
    expect((await readConfiguredUtilities('owner','budget',dbClient))[0]).toMatchObject({id:'electricity',scheduleIds:['sce-schedule'],payeeId:'sce'});
    expect(connectionPayLinks(after.connections)).toEqual([{scheduleId:'sce-schedule',label:'Electricity',url:'https://sce.example/pay'}]);
    expect(JSON.parse(String((await dbClient.execute("SELECT financial_profiles_json FROM ea_settings WHERE user_id='owner'")).rows[0]?.financial_profiles_json))).toEqual([utilityProfile,cardProfile]);
    expect((await migrate()).revision).toBe(8);
    await expect(updateUtilityMapping('owner','electricity',{budgetId:'budget',payeeId:'sce',scheduleIds:['sce-schedule']},{dbClient})).rejects.toMatchObject({status:409});
  });
  it('rejects stale migration previews and leaves no partial configuration',async()=>{
    const preview=await previewFinancialConnectionMigration('owner',dbClient);
    await dbClient.execute("UPDATE ea_settings SET utility_pay_links_json='[]' WHERE user_id='owner'");
    await expect(applyFinancialConnectionMigration('owner',preview.fingerprint,{dbClient})).rejects.toMatchObject({status:409});
    expect((await dbClient.execute('SELECT * FROM ea_financial_connections')).rows).toEqual([]);
    expect((await readFinancialConnections('owner',{dbClient})).migrated).toBe(false);
  });
  it('saves targets and links together and rejects stale revisions and changed budgets',async()=>{
    await migrate();
    const current=await readFinancialConnections('owner',{dbClient});
    const connections=current.connections.map(row=>({...row,payLink:row.utility?'https://sce.example/new':undefined}));
    const input={budgetId:'budget',revision:current.revision,connections};
    expect(await saveFinancialConnections('owner',input,{dbClient})).toMatchObject({revision:9,connections:[{payLink:'https://sce.example/new'},{id:'citi-profile'}]});
    await expect(saveFinancialConnections('owner',input,{dbClient})).rejects.toMatchObject({status:409});
    await dbClient.execute("UPDATE ea_settings SET actual_budget_sync_id='replacement' WHERE user_id='owner'");
    await expect(saveFinancialConnections('owner',{...input,revision:9},{dbClient})).rejects.toMatchObject({status:409});
    expect((await readFinancialProfiles('owner',{dbClient})).profiles).toEqual([]);
  });
  it('keeps unsupported or invalid legacy targets inactive and rejects unknown automation',async()=>{
    await dbClient.execute({sql:"UPDATE ea_settings SET financial_profiles_json=? WHERE user_id='owner'",args:[JSON.stringify([utilityProfile,{...cardProfile,target:{...cardProfile.target,toAccountId:'deleted'}},{...cardProfile,id:'unknown',senderAddresses:['unknown@example.test']}])]});
    await migrate();
    const current=await readFinancialConnections('owner',{dbClient});
    expect(current.connections.map(row=>row.enabled)).toEqual([true,false,false]);
    const bad=current.connections.map(row=>row.id==='unknown'?{...row,enabled:true}:row);
    await expect(saveFinancialConnections('owner',{budgetId:'budget',revision:current.revision,connections:bad},{dbClient})).rejects.toMatchObject({status:400});
    expect((await readFinancialConnections('owner',{dbClient})).revision).toBe(current.revision);
  });
  it('requires exact available utility targets and safe pay links before atomic save',async()=>{
    await migrate();
    const current=await readFinancialConnections('owner',{dbClient});
    for(const patch of [{payLink:'javascript:alert(1)'},{utility:{...current.connections[0]!.utility,payeeId:'different'}},{target:{kind:'utility',scheduleId:'deleted'}}]) {
      const connections=current.connections.map((row,i)=>i?row:{...row,...patch});
      await expect(saveFinancialConnections('owner',{budgetId:'budget',revision:current.revision,connections},{dbClient})).rejects.toMatchObject({status:400});
    }
    expect((await readFinancialConnections('owner',{dbClient})).revision).toBe(current.revision);
  });
});
