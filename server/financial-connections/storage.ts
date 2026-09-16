import type { InStatement } from '@libsql/client';
import db from '../db/connection.ts';
import type { FinancialConnection, FinancialConnectionConfiguration } from '../../shared/types/financial-connections.ts';
import type { FinancialProfile } from '../../shared/types/financial-profiles.ts';
import type { UtilityIdentity } from '../../shared/types/finances.ts';
import type { UtilityPayLink } from '../../shared/types/settings.ts';
import { FINANCIAL_PROVIDER_CATALOG } from '../../shared/types/financial-parsers.ts';

export interface ConnectionReader { execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }> }

/** Compatibility with older offline schema snapshots, never a fallback on malformed canonical data. */
export async function financialConnectionsMigrated(userId: string, dbClient: ConnectionReader = db): Promise<boolean> {
  const schema = await dbClient.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ea_financial_connection_state'");
  if (!schema.rows.length) return false;
  return !!(await dbClient.execute({ sql:'SELECT user_id FROM ea_financial_connection_state WHERE user_id=?', args:[userId] })).rows.length;
}
export async function readCanonicalConnections(userId: string, dbClient: ConnectionReader = db): Promise<FinancialConnectionConfiguration | null> {
  if (!await financialConnectionsMigrated(userId, dbClient)) return null;
  const state = await dbClient.execute({sql:`SELECT s.actual_budget_sync_id,c.revision FROM ea_financial_connection_state c
    JOIN ea_settings s ON s.user_id=c.user_id WHERE c.user_id=?`,args:[userId]});
  const budgetId = state.rows[0]?.actual_budget_sync_id ? String(state.rows[0].actual_budget_sync_id) : null;
  const rows = await dbClient.execute({sql:'SELECT configuration_json FROM ea_financial_connections WHERE user_id=? AND budget_id=? ORDER BY position,id',args:[userId,budgetId]});
  return { budgetId, revision:Number(state.rows[0]?.revision || 0), migrated:true,
    connections:rows.rows.map(row => JSON.parse(String(row.configuration_json)) as FinancialConnection) };
}
export function connectionProfiles(connections: FinancialConnection[]): FinancialProfile[] {
  return connections.flatMap(connection => {
    if (connection.target.kind === 'schedule_link') return [];
    const {providerId,utility: _utility,payLink: _payLink,migrationWarning: _warning,...profile} = connection;
    const provider = FINANCIAL_PROVIDER_CATALOG.find(entry=>entry.id===providerId);
    return [{...profile,...(provider ? {providerId:provider.id} : {}),target:connection.target,enabled:profile.enabled && !!provider,
      senderAddresses:profile.senderAddresses}];
  });
}
export function connectionUtilities(connections: FinancialConnection[]): UtilityIdentity[] {
  return connections.flatMap(connection => connection.utility && 'scheduleId' in connection.target && connection.target.scheduleId
    ? [{...connection.utility,budgetId:connection.budgetId,scheduleIds:[connection.target.scheduleId]}] : []);
}
export function connectionPayLinks(connections: FinancialConnection[]): UtilityPayLink[] {
  return connections.flatMap(connection=>connection.payLink && 'scheduleId' in connection.target && connection.target.scheduleId
    ? [{scheduleId:connection.target.scheduleId,label:connection.utility?.label || connection.name,url:connection.payLink}] : []);
}
export async function readConfiguredUtilities(userId: string, budgetId: string, dbClient: ConnectionReader = db): Promise<UtilityIdentity[]> {
  const canonical = await readCanonicalConnections(userId,dbClient);
  if (canonical) return canonical.budgetId===budgetId ? connectionUtilities(canonical.connections) : [];
  const result = await dbClient.execute({sql:'SELECT * FROM ea_finance_utilities WHERE user_id=? AND budget_id=? ORDER BY rowid',args:[userId,budgetId]});
  return result.rows.map(row=>({id:String(row.id),label:String(row.label),provider:String(row.provider),budgetId,
    payeeId:String(row.payee_id),scheduleIds:JSON.parse(String(row.schedule_ids_json)),sourceSenders:JSON.parse(String(row.source_senders_json)),sourceIdentityText:String(row.source_identity_text || '')}));
}
