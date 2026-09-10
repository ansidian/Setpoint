import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { readUtilityMappings, updateUtilityMapping } from './utility-mappings.ts';

let dbClient: Client;
const original = { id:'electricity', label:'Electricity', provider:'Provider', budgetId:'budget', payeeId:'old', scheduleIds:['old-schedule'], sourceSenders:['billing@example.test'], sourceIdentityText:'account identity' };
const update = { budgetId:'budget', payeeId:'new', scheduleIds:['new-schedule'] };
beforeEach(async () => {
  dbClient = createClient({ url:'file::memory:' });
  await dbClient.executeMultiple('CREATE TABLE ea_settings (user_id TEXT PRIMARY KEY, actual_budget_sync_id TEXT);');
  for (const file of ['009_actual_metadata_mirror.sql','065_finance_utilities.sql']) await dbClient.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
  await dbClient.execute("INSERT INTO ea_settings VALUES ('owner','budget')");
  await dbClient.execute({ sql:'INSERT INTO ea_finance_utilities VALUES (?,?,?,?,?,?,?,?,?)', args:['owner','budget',original.id,original.label,original.provider,original.payeeId,JSON.stringify(original.scheduleIds),JSON.stringify(original.sourceSenders),original.sourceIdentityText] });
  const schedules = [
    {id:'new-schedule',type:'bill',conditions:[{field:'payee',op:'is',value:'new'}]},
    {id:'wrong-payee',type:'bill',conditions:[{field:'payee',op:'is',value:'different'}]},
    {id:'retired',type:'bill',completed:true,conditions:[{field:'payee',op:'is',value:'new'}]},
    {id:'income',type:'income',conditions:[{field:'payee',op:'is',value:'new'}]},
  ];
  await dbClient.execute({ sql:"INSERT INTO ea_actual_metadata_mirror (user_id,status,payees_json,schedules_json) VALUES ('owner','current',?,?)",args:[JSON.stringify([{id:'new',name:'New Provider'}]),JSON.stringify(schedules)] });
});
afterEach(() => dbClient.close());

describe('budget-bound utility mapping edits', () => {
  it('repairs exact destinations while preserving identity and source evidence', async () => {
    expect((await readUtilityMappings('owner',{dbClient})).utilities).toEqual([original]);
    expect(await updateUtilityMapping('owner','electricity',update,{dbClient})).toEqual({...original,...update});
    expect((await readUtilityMappings('owner',{dbClient})).utilities).toEqual([{...original,...update}]);
  });
  it('rejects wrong budgets, unknown utilities, and unavailable or mismatched destinations without changing configuration', async () => {
    await expect(updateUtilityMapping('owner','electricity',{...update,budgetId:'other'},{dbClient})).rejects.toMatchObject({status:409});
    for (const input of [{...update,payeeId:'deleted'}, ...['missing','wrong-payee','retired','income'].map(id=>({...update,scheduleIds:[id]})), {...update,scheduleIds:[]}]) {
      await expect(updateUtilityMapping('owner','electricity',input,{dbClient})).rejects.toMatchObject({status:400});
    }
    await expect(updateUtilityMapping('owner','unknown',update,{dbClient})).rejects.toMatchObject({status:404});
    expect((await readUtilityMappings('owner',{dbClient})).utilities).toEqual([original]);
  });
  it('keeps unavailable and replacement budgets explicit', async () => {
    await dbClient.execute("DELETE FROM ea_actual_metadata_mirror WHERE user_id='owner'");
    expect(await readUtilityMappings('owner',{dbClient})).toMatchObject({metadataAvailable:false,utilities:[original],payees:[],schedules:[]});
    await expect(updateUtilityMapping('owner','electricity',update,{dbClient})).rejects.toMatchObject({status:503});
    await dbClient.execute("UPDATE ea_settings SET actual_budget_sync_id='replacement' WHERE user_id='owner'");
    await expect(updateUtilityMapping('owner','electricity',update,{dbClient})).rejects.toMatchObject({status:409});
    expect((await readUtilityMappings('owner',{dbClient})).utilities).toEqual([]);
  });
});
