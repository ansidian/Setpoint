import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';
import db from '../db/connection.ts';
import { readActualMetadataProjection } from '../actual/actual.ts';
import type { FinancialConnection } from '../../shared/types/financial-connections.ts';
import { FINANCIAL_PROVIDER_CATALOG } from '../../shared/types/financial-parsers.ts';
import { validateFinancialProfiles } from '../bills/financial-profiles.ts';
import { readConfiguredUtilities, readCanonicalConnections, type ConnectionReader } from './storage.ts';

const fail = (status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
export interface ConnectionMigrationPreview {
  budgetId:string|null; revision:number; fingerprint:string; connections:FinancialConnection[]; warnings:string[]; migrated:boolean;
}
function array(value:unknown): unknown[] {
  const parsed = JSON.parse(String(value || '[]'));
  if (!Array.isArray(parsed)) throw new Error('Legacy configuration must be an array. Repair it before migration.');
  return parsed;
}
export async function previewFinancialConnectionMigration(userId:string,dbClient:ConnectionReader=db):Promise<ConnectionMigrationPreview> {
  const canonical=await readCanonicalConnections(userId,dbClient);
  if(canonical) return {...canonical,fingerprint:'',warnings:[],migrated:true};
  const settings=(await dbClient.execute({sql:'SELECT actual_budget_sync_id,financial_profiles_json,financial_profiles_revision,utility_pay_links_json FROM ea_settings WHERE user_id=?',args:[userId]})).rows[0];
  const budgetId=settings?.actual_budget_sync_id ? String(settings.actual_budget_sync_id) : null;
  const utilities=budgetId ? await readConfiguredUtilities(userId,budgetId,dbClient) : [];
  const profiles=array(settings?.financial_profiles_json);
  const links=array(settings?.utility_pay_links_json) as Array<{scheduleId:string;label:string;url:string}>;
  const metadata=await readActualMetadataProjection(userId,{dbClient});
  const fingerprint=createHash('sha256').update(JSON.stringify([settings || null,utilities,metadata ? [metadata.accounts,metadata.payees,metadata.categories,metadata.schedules] : null])).digest('hex');
  const warnings:string[]=[];
  const connections:FinancialConnection[]=[];
  const consumedUtilities=new Set<string>();
  const consumedLinks=new Set<string>();
  for(const [index,raw] of profiles.entries()) {
    // Shape validation is independent of availability when a legacy entry is inactive.
    const shape=validateFinancialProfiles([{...(raw as object),enabled:false}],{budgetId:null,metadata:null});
    if(!shape.valid) {
      const message=`Legacy profile ${index+1} has invalid fields and remains archived for repair.`;
      warnings.push(message);
      const record=raw && typeof raw==='object' ? raw as Record<string,unknown> : {};
      connections.push({id:typeof record.id==='string' ? record.id : `legacy-invalid-${index}`,name:typeof record.name==='string' ? record.name : `Legacy profile ${index+1}`,enabled:false,budgetId:typeof record.budgetId==='string' ? record.budgetId : budgetId || '',senderAddresses:[],providerId:null,target:{kind:'schedule_link',scheduleId:`unresolved-${index}`},migrationWarning:message});
      continue;
    }
    const profile={...shape.value[0]!,enabled:(raw as {enabled?:unknown}).enabled===true};
    const providers=FINANCIAL_PROVIDER_CATALOG.filter(provider=>profile.senderAddresses.some(sender=>(provider.senderAddresses as readonly string[]).includes(sender)));
    const provider=providers.length===1 ? providers[0]! : null;
    const connection:FinancialConnection={...profile,providerId:provider?.id || null,enabled:profile.enabled && !!provider && profile.budgetId===budgetId};
    if(provider?.id==='citi' && profile.target.kind==='card_payment' && connection.merchantName==='Citi Costco Wholesale') {connection.merchantName='Citi';warnings.push(`${profile.name}: normalized the legacy Citi merchant constraint to the source label Citi.`);}
    if(provider?.id==='citi' && profile.target.kind==='card_payment' && !connection.senderAddresses.includes('citicards@info6.citi.com')) connection.senderAddresses=[...connection.senderAddresses,'citicards@info6.citi.com'];
    if(!provider || profile.budgetId!==budgetId) {connection.migrationWarning='Existing configuration is inactive until its provider and current budget are verified.';warnings.push(`${profile.name}: ${connection.migrationWarning}`);}
    if(connection.enabled && metadata) {
      const validated=validateFinancialProfiles([profile],{budgetId,metadata});
      if(!validated.valid) {connection.enabled=false;connection.migrationWarning=validated.message;warnings.push(`${profile.name}: ${validated.message}`);}
    }
    const scheduleId='scheduleId' in profile.target ? profile.target.scheduleId : undefined;
    const matching=utilities.filter(utility=>utility.scheduleIds.includes(scheduleId || ''));
    if(matching.length>1 || (matching[0] && consumedUtilities.has(matching[0].id))) fail(409,'Conflicting legacy utility membership. Repair configuration before migration.');
    if(matching[0]) {const {budgetId:_budgetId,scheduleIds:_schedules,...utility}=matching[0];connection.utility=utility;consumedUtilities.add(utility.id);}
    const matchedLinks=links.filter(link=>link.scheduleId===scheduleId);
    if(matchedLinks.length>1) fail(409,'Conflicting legacy payment links. Repair configuration before migration.');
    if(matchedLinks[0]) {connection.payLink=matchedLinks[0].url;consumedLinks.add(matchedLinks[0].scheduleId);}
    connections.push(connection);
  }
  for(const utility of utilities.filter(row=>!consumedUtilities.has(row.id))) {
    if(utility.scheduleIds.length!==1) fail(409,'Legacy utility must have exactly one schedule before migration.');
    const {budgetId:_budgetId,scheduleIds,...identity}=utility;
    const provider=FINANCIAL_PROVIDER_CATALOG.find(entry=>utility.sourceSenders.some(sender=>(entry.senderAddresses as readonly string[]).includes(sender)));
    const link=links.find(entry=>entry.scheduleId===scheduleIds[0]);
    if(link) consumedLinks.add(link.scheduleId);
    connections.push({id:`utility:${utility.id}`,name:utility.label,enabled:false,budgetId:utility.budgetId,senderAddresses:utility.sourceSenders,providerId:provider?.id || null,target:{kind:'schedule_link',scheduleId:scheduleIds[0]!},utility:identity,...(link?{payLink:link.url}:{})});
  }
  for(const link of links.filter(row=>!consumedLinks.has(row.scheduleId))) connections.push({id:`pay-link:${link.scheduleId}`,name:link.label || 'Payment link',enabled:false,budgetId:budgetId || '',senderAddresses:[],providerId:null,target:{kind:'schedule_link',scheduleId:link.scheduleId},payLink:link.url});
  if(new Set(connections.map(row=>`${row.budgetId}:${row.id}`)).size!==connections.length) fail(409,'Conflicting legacy connection IDs. Repair configuration before migration.');
  return {budgetId,revision:Number(settings?.financial_profiles_revision || 0),fingerprint,connections,warnings,migrated:false};
}
/** Explicit, fingerprint-guarded migration. Never invoked by GET, never writes to Actual. */
export async function applyFinancialConnectionMigration(userId:string,fingerprint:string,{dbClient=db}:{dbClient?:Pick<Client,'transaction'>}={}) {
  const tx=await dbClient.transaction('write');
  try {
    const preview=await previewFinancialConnectionMigration(userId,tx);
    if(preview.migrated) {await tx.commit();return preview;}
    if(!fingerprint || fingerprint!==preview.fingerprint) fail(409,'Legacy configuration changed. Preview the migration again.');
    if(preview.connections.some(connection=>connection.enabled) && !await readActualMetadataProjection(userId,{dbClient:tx})) fail(503,'Sync Actual metadata before migrating enabled providers.');
    if(!preview.budgetId) fail(409,'Connect an Actual budget before migrating financial providers.');
    for(const [position,connection] of preview.connections.entries()) await tx.execute({sql:'INSERT INTO ea_financial_connections (user_id,budget_id,id,provider_id,configuration_json,position) VALUES (?,?,?,?,?,?)',args:[userId,connection.budgetId,connection.id,connection.providerId,JSON.stringify(connection),position]});
    await tx.execute({sql:'INSERT INTO ea_financial_connection_state (user_id,revision,source_fingerprint) VALUES (?,?,?)',args:[userId,preview.revision+1,preview.fingerprint]});
    await tx.commit();return {...preview,revision:preview.revision+1,migrated:true};
  } catch(error) {await tx.rollback();throw error;} finally {tx.close();}
}
