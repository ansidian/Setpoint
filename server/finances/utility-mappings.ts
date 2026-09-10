import type { Client, Row } from '@libsql/client';
import db from '../db/connection.ts';
import { readActualMetadataProjection } from '../actual/actual.ts';
import type { UtilityIdentity, UtilityMappingSettings } from '../../shared/types/finances.ts';

type MappingDb = Pick<Client, 'execute'>;
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const project = (row: Row): UtilityIdentity => ({ id: String(row.id), label: String(row.label), provider: String(row.provider),
  budgetId: String(row.budget_id), payeeId: String(row.payee_id), scheduleIds: JSON.parse(String(row.schedule_ids_json)),
  sourceSenders: JSON.parse(String(row.source_senders_json)), sourceIdentityText: String(row.source_identity_text || '') });

export async function readUtilityMappings(userId: string, { dbClient = db }: { dbClient?: MappingDb } = {}): Promise<UtilityMappingSettings> {
  const settings = await dbClient.execute({ sql: 'SELECT actual_budget_sync_id FROM ea_settings WHERE user_id=?', args: [userId] });
  const budgetId = settings.rows[0]?.actual_budget_sync_id ? String(settings.rows[0].actual_budget_sync_id) : null;
  if (!budgetId) return { budgetId, utilities: [], payees: [], schedules: [], metadataAvailable: false };
  const [membership, metadata] = await Promise.all([
    dbClient.execute({ sql: 'SELECT * FROM ea_finance_utilities WHERE user_id=? AND budget_id=? ORDER BY rowid', args: [userId, budgetId] }),
    readActualMetadataProjection(userId, { dbClient }),
  ]);
  return { budgetId, utilities: membership.rows.map(project), payees: metadata?.payees || [],
    schedules: (metadata?.schedules || []).filter(row => !row.completed && row.type === 'bill'), metadataAvailable: !!metadata };
}

/** Edits only Setpoint's existing membership. Provider/source evidence and Actual objects are untouched. */
export async function updateUtilityMapping(userId: string, id: string, input: unknown, { dbClient = db }: { dbClient?: MappingDb } = {}): Promise<UtilityIdentity> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Choose a budget, payee and schedule.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['budgetId', 'payeeId', 'scheduleIds'].includes(key))
    || typeof body.budgetId !== 'string' || !body.budgetId || typeof body.payeeId !== 'string' || !body.payeeId
    || !Array.isArray(body.scheduleIds) || body.scheduleIds.length !== 1
    || body.scheduleIds.some(value => typeof value !== 'string' || !value) || new Set(body.scheduleIds).size !== body.scheduleIds.length) fail(400, 'Choose one payee and exactly one schedule.');
  const current = await readUtilityMappings(userId, { dbClient });
  if (!current.budgetId || current.budgetId !== body.budgetId) fail(409, 'The Actual budget changed. Reload utility mappings.');
  const utility = current.utilities.find(row => row.id === id);
  if (!utility) fail(404, 'Utility mapping not found in this budget.');
  if (!current.metadataAvailable) fail(503, 'Actual metadata is unavailable. Sync Actual before editing mappings.');
  if (!current.payees.some(row => row.id === body.payeeId)) fail(400, 'Choose an available Actual payee.');
  const scheduleIds = body.scheduleIds as string[];
  for (const scheduleId of scheduleIds) {
    const schedule = current.schedules.find(row => row.id === scheduleId);
    const payees = schedule?.conditions?.filter(condition => condition.field === 'payee') || [];
    if (!schedule || payees.length !== 1 || payees[0]?.op !== 'is' || payees[0]?.value !== body.payeeId) fail(400, 'Each schedule must belong to the selected Actual payee.');
    if (current.utilities.some(row => row.id !== id && row.scheduleIds.includes(scheduleId))) fail(400, 'That schedule already belongs to another utility.');
  }
  const result = await dbClient.execute({ sql: `UPDATE ea_finance_utilities SET payee_id=?,schedule_ids_json=?
    WHERE user_id=? AND budget_id=? AND id=? AND EXISTS (SELECT 1 FROM ea_settings WHERE user_id=? AND actual_budget_sync_id=?)`,
  args: [body.payeeId as string, JSON.stringify(scheduleIds), userId, current.budgetId, id, userId, current.budgetId] });
  if (result.rowsAffected !== 1) fail(409, 'The Actual budget changed. Reload utility mappings.');
  return { ...utility!, payeeId: body.payeeId as string, scheduleIds };
}
