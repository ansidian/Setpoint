import type { Client } from '@libsql/client';
import db from '../db/connection.ts';
import { readActualMetadataProjection } from '../actual/actual.ts';
import { validateFinancialProfiles } from '../bills/financial-profiles.ts';
import type { FinancialConnection, FinancialConnectionConfiguration } from '../../shared/types/financial-connections.ts';
import type { ActualMetadata } from '../../shared/types/actual.ts';
import { FINANCIAL_PROVIDER_CATALOG } from '../../shared/types/financial-parsers.ts';
import { readCanonicalConnections, connectionProfiles } from './storage.ts';
import { previewFinancialConnectionMigration } from './migration.ts';

const fail=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const text=(value:unknown,limit=200):value is string=>typeof value==='string' && !!value.trim() && value.length<=limit && [...value].every(character=>character.charCodeAt(0)>31 && character.charCodeAt(0)!==127);
export async function readFinancialConnections(userId:string,{dbClient=db}:{dbClient?:Pick<Client,'execute'>}={}):Promise<FinancialConnectionConfiguration> {
  const canonical=await readCanonicalConnections(userId,dbClient);
  if(canonical) return canonical;
  const preview=await previewFinancialConnectionMigration(userId,dbClient);
  return {budgetId:preview.budgetId,revision:preview.revision,connections:preview.connections,migrated:false};
}
function validateConnections(value:unknown,budgetId:string,metadata:ActualMetadata|null,existing:FinancialConnection[]):FinancialConnection[] {
  if(!Array.isArray(value) || value.length>100) return fail(400,'Provide at most 100 financial providers.');
  const ids=new Set<string>();const utilities=new Set<string>();const schedules=new Set<string>();
  const connections:FinancialConnection[]=value.map(raw=>{
    if(!object(raw) || Object.keys(raw).some(key=>!['id','name','enabled','budgetId','senderAddresses','merchantName','accountLast4','target','providerId','utility','payLink','migrationWarning'].includes(key))) return fail(400,'Unsupported financial provider fields.');
    if(!text(raw.id,128)||!text(raw.name,120)||raw.budgetId!==budgetId||typeof raw.enabled!=='boolean'||ids.has(raw.id)) return fail(400,'Providers need unique IDs, names and the current budget.');
    ids.add(raw.id);
    const provider=FINANCIAL_PROVIDER_CATALOG.find(entry=>entry.id===raw.providerId);
    if(raw.providerId!==null && !provider) return fail(400,'Choose a supported provider.');
    if(!object(raw.target)) return fail(400,'Choose a financial destination.');
    if(raw.enabled && (!provider || raw.target.kind==='schedule_link')) return fail(400,'Payment links and unsupported providers cannot enable automatic processing.');
    const result={...raw} as unknown as FinancialConnection;
    if(raw.enabled && provider && (!Array.isArray(raw.senderAddresses) || raw.senderAddresses.some(sender=>!(provider.senderAddresses as readonly unknown[]).includes(sender)))) return fail(400,'Automatic processing requires exact supported sender addresses.');
    if(raw.target.kind==='schedule_link') {
      if(Object.keys(raw.target).some(key=>!['kind','scheduleId'].includes(key)) || !text(raw.target.scheduleId,128)) return fail(400,'Choose an exact schedule.');
      if(!Array.isArray(result.senderAddresses)||result.senderAddresses.some(sender=>typeof sender!=='string')) return fail(400,'Sender addresses must be strings.');
      const scheduleId = raw.target.scheduleId;
      const prior=existing.find(entry=>entry.id===result.id);
      if((!prior || JSON.stringify(prior.target)!==JSON.stringify(result.target)) && !metadata?.schedules.some(schedule=>schedule.id===scheduleId)) return fail(400,'Choose an available Actual schedule.');
    }
    if(raw.utility!==undefined) {
      const utility=raw.utility;
      if(!object(utility)||Object.keys(utility).some(key=>!['id','label','provider','payeeId','sourceSenders','sourceIdentityText'].includes(key))
        ||!text(utility.id,128)||!text(utility.label,120)||!text(utility.provider,200)||!text(utility.payeeId,128)
        ||!Array.isArray(utility.sourceSenders)||!utility.sourceSenders.length||utility.sourceSenders.some(sender=>!text(sender,254))
        ||(utility.sourceIdentityText!==undefined && (typeof utility.sourceIdentityText!=='string'||utility.sourceIdentityText.length>200))) return fail(400,'Invalid utility identity.');
      if(!('scheduleId' in result.target)||!result.target.scheduleId||!['utility','schedule_link'].includes(result.target.kind)) return fail(400,'A utility needs an exact bill schedule.');
      if(utilities.has(utility.id)||schedules.has(result.target.scheduleId)) return fail(400,'A utility identity or schedule cannot belong to multiple providers.');
      utilities.add(utility.id);schedules.add(result.target.scheduleId);
      const prior=existing.find(entry=>entry.id===result.id);
      const unchanged=prior && JSON.stringify(prior.utility)===JSON.stringify(result.utility) && JSON.stringify(prior.target)===JSON.stringify(result.target);
      if(!unchanged) {
        const scheduleId = result.target.scheduleId;
        const schedule=metadata?.schedules.find(entry=>entry.id===scheduleId);
        if(!schedule || schedule.type!=='bill'||schedule.completed||!metadata?.payees.some(payee=>payee.id===utility.payeeId&&!payee.transfer_acct)
          ||!schedule.conditions?.some(condition=>['payee','description'].includes(String(condition.field))&&condition.op==='is'&&condition.value===utility.payeeId)) return fail(400,'The utility schedule must belong to the selected Actual payee.');
      }
    }
    if(raw.payLink!==undefined) {
      if(!text(raw.payLink,2048)||!('scheduleId' in result.target)||!result.target.scheduleId) return fail(400,'Payment links need an exact schedule and an http or https URL.');
      let url:URL;try{url=new URL(raw.payLink);}catch{return fail(400,'Enter a valid payment URL.');}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password) return fail(400,'Enter an http or https payment URL without credentials.');
    }
    if(raw.migrationWarning!==undefined && !text(raw.migrationWarning,1000)) return fail(400,'Invalid migration warning.');
    return result;
  });
  const validation=validateFinancialProfiles(connectionProfiles(connections),{budgetId,metadata,existingProfiles:connectionProfiles(existing)});
  if(!validation.valid) return fail(400,validation.message);
  return connections;
}
export async function saveFinancialConnections(userId:string,input:unknown,{dbClient=db}:{dbClient?:Pick<Client,'execute'|'transaction'>}={}):Promise<FinancialConnectionConfiguration> {
  if(!object(input)||Object.keys(input).some(key=>!['budgetId','revision','connections'].includes(key))||!text(input.budgetId,128)||!Number.isSafeInteger(input.revision)||Number(input.revision)<0) return fail(400,'Provide a budget, revision and financial providers.');
  const current=await readCanonicalConnections(userId,dbClient);
  if(!current) return fail(409,'Financial providers must be migrated before editing.');
  if(current.budgetId!==input.budgetId||current.revision!==input.revision) return fail(409,'Financial providers or the Actual budget changed. Reload before saving.');
  const metadata=await readActualMetadataProjection(userId,{dbClient});
  const connections=validateConnections(input.connections,input.budgetId,metadata,current.connections);
  const tx=await dbClient.transaction('write');
  try {
    const updated=await tx.execute({sql:`UPDATE ea_financial_connection_state SET revision=revision+1 WHERE user_id=? AND revision=?
      AND EXISTS (SELECT 1 FROM ea_settings WHERE user_id=? AND actual_budget_sync_id=?)`,args:[userId,Number(input.revision),userId,input.budgetId]});
    if(updated.rowsAffected!==1) return fail(409,'Financial providers or the Actual budget changed. Reload before saving.');
    await tx.execute({sql:'DELETE FROM ea_financial_connections WHERE user_id=? AND budget_id=?',args:[userId,input.budgetId]});
    for(const [position,connection] of connections.entries()) await tx.execute({sql:'INSERT INTO ea_financial_connections (user_id,budget_id,id,provider_id,configuration_json,position) VALUES (?,?,?,?,?,?)',args:[userId,input.budgetId,connection.id,connection.providerId,JSON.stringify(connection),position]});
    await tx.commit();return {budgetId:input.budgetId,revision:Number(input.revision)+1,connections,migrated:true};
  } catch(error) {await tx.rollback();throw error;} finally {tx.close();}
}
