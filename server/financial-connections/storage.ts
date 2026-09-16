import type { InStatement } from '@libsql/client';
import db from '../db/connection.ts';
import type { FinancialConnection, FinancialConnectionConfiguration } from '../../shared/types/financial-connections.ts';
import type { UtilityIdentity } from '../../shared/types/finances.ts';
import { connectionUtilities } from '../../shared/financial-connection-projections.ts';
export { connectionProfiles, connectionUtilities, connectionPayLinks } from '../../shared/financial-connection-projections.ts';

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
export async function readConfiguredUtilities(userId: string, budgetId: string, dbClient: ConnectionReader = db): Promise<UtilityIdentity[]> {
  const canonical = await readCanonicalConnections(userId,dbClient);
  if (canonical) return canonical.budgetId===budgetId ? connectionUtilities(canonical.connections) : [];
  const result = await dbClient.execute({sql:'SELECT * FROM ea_finance_utilities WHERE user_id=? AND budget_id=? ORDER BY rowid',args:[userId,budgetId]});
  return result.rows.map(row=>({id:String(row.id),label:String(row.label),provider:String(row.provider),budgetId,
    payeeId:String(row.payee_id),scheduleIds:JSON.parse(String(row.schedule_ids_json)),sourceSenders:JSON.parse(String(row.source_senders_json)),sourceIdentityText:String(row.source_identity_text || '')}));
}
