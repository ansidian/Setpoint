import type { Client } from '@libsql/client';
import db from '../db/connection.ts';
import { initializePaymentOrganization, reconcilePaymentOrganization, validatePaymentOrganization } from '../../shared/payment-groups.ts';
import type { PaymentItem, PaymentOrganization } from '../../shared/types/payment-groups.ts';

type OrganizationDb = Pick<Client, 'execute'>;
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };

/** A missing document is a read-only starter layout; reading never persists it. */
export async function readPaymentOrganization(
  userId: string, budgetId: string, items: PaymentItem[], { dbClient = db }: { dbClient?: OrganizationDb } = {},
): Promise<PaymentOrganization> {
  const result = await dbClient.execute({
    sql: 'SELECT revision, groups_json FROM ea_payment_organizations WHERE user_id=? AND budget_id=?',
    args: [userId, budgetId],
  });
  const row = result.rows[0];
  if (!row) return initializePaymentOrganization(budgetId, items);
  let groups: unknown;
  try { groups = JSON.parse(String(row.groups_json)); }
  catch { fail(503, 'Saved payment groups could not be read. Try loading Payments again.'); }
  const parsed = validatePaymentOrganization({ budgetId, revision: Number(row.revision), groups });
  if (!parsed.valid) return fail(503, 'Saved payment groups could not be read. Try loading Payments again.');
  return reconcilePaymentOrganization(parsed.value, items);
}

/** Saves one complete draft, with the active budget and revision checked by the same database write. */
export async function savePaymentOrganization(
  userId: string, input: unknown, { dbClient = db }: { dbClient?: OrganizationDb } = {},
): Promise<PaymentOrganization> {
  const parsed = validatePaymentOrganization(input);
  if (!parsed.valid) return fail(400, parsed.message);
  const organization = parsed.value;
  const settings = await dbClient.execute({ sql: 'SELECT actual_budget_sync_id FROM ea_settings WHERE user_id=?', args: [userId] });
  if (settings.rows[0]?.actual_budget_sync_id !== organization.budgetId) {
    return fail(409, 'The Actual budget changed. Reload Payments before saving.');
  }
  const groups = JSON.stringify(organization.groups);
  const saved = organization.revision === 0
    ? await dbClient.execute({
      sql: `INSERT INTO ea_payment_organizations (user_id, budget_id, revision, groups_json)
        SELECT ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM ea_settings WHERE user_id=? AND actual_budget_sync_id=?)
        ON CONFLICT(user_id, budget_id) DO NOTHING`,
      args: [userId, organization.budgetId, groups, userId, organization.budgetId],
    })
    : await dbClient.execute({
      sql: `UPDATE ea_payment_organizations SET groups_json=?, revision=revision+1, updated_at=datetime('now')
        WHERE user_id=? AND budget_id=? AND revision=?
          AND EXISTS (SELECT 1 FROM ea_settings WHERE user_id=? AND actual_budget_sync_id=?)`,
      args: [groups, userId, organization.budgetId, organization.revision, userId, organization.budgetId],
    });
  if (saved.rowsAffected !== 1) return fail(409, 'Payments changed in another session or the Actual budget changed. Reload Payments before saving.');
  return { ...organization, revision: organization.revision + 1 };
}
