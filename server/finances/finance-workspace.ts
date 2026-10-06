import db from '../db/connection.ts';
import { readActualMetadataProjection, readJournalRange } from '../actual/actual.ts';
import { readBillsMirrorRange } from '../bills/bills-service.ts';
import { hydrateLegacyOccurrencePayments } from './occurrence-payments.ts';
import { buildPaymentCatalog, readRetainedPaymentSchedules } from './payment-catalog.ts';
import { readPaymentOrganization } from './payment-groups.ts';
import type { FinanceWorkspace } from '../../shared/types/finances.ts';

/** Read-only composition of Actual schedules, the Actual journal and saved display groups. */
export async function readFinanceWorkspace(userId: string): Promise<FinanceWorkspace> {
  const end = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const start = new Date(`${end}T00:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 1);
  const range = { start: start.toISOString().slice(0, 10), end };
  const settings = await db.execute({ sql: 'SELECT actual_budget_sync_id FROM ea_settings WHERE user_id=?', args: [userId] });
  const budgetId = settings.rows[0]?.actual_budget_sync_id ? String(settings.rows[0].actual_budget_sync_id) : null;
  const result: FinanceWorkspace = { budgetId, ...range, recurring: [], updatedAt: null, issues: [], truncated: false };
  if (!budgetId) { result.issues.push('Connect Actual to see recurring payments and the journal.'); return result; }
  const lookahead = new Date(`${range.end}T00:00:00Z`); lookahead.setUTCMonth(lookahead.getUTCMonth() + 3);
  const [metadata, mirror, journal, retained] = await Promise.allSettled([
    readActualMetadataProjection(userId), readBillsMirrorRange(userId, { start: range.start, end: lookahead.toISOString().slice(0, 10) }),
    readJournalRange(userId, { ...range, limit: 2000 }), readRetainedPaymentSchedules(userId),
  ]);
  const meta = metadata.status === 'fulfilled' ? metadata.value : null;
  const transactions = journal.status === 'fulfilled' ? journal.value.transactions : [];
  result.recurring = hydrateLegacyOccurrencePayments(mirror.status === 'fulfilled' ? mirror.value.schedules : [], transactions);
  if (journal.status === 'fulfilled') result.recordedHistory = journal.value;
  result.actualBudgetUrl = mirror.status === 'fulfilled' ? mirror.value.actualBudgetUrl : null;
  result.updatedAt = meta?.syncHealth.lastSuccessAt || null;
  result.truncated = journal.status === 'fulfilled' && journal.value.truncated;
  if (!meta) result.issues.push('Actual metadata is unavailable.');
  if (journal.status === 'rejected') result.issues.push('Recorded payments are unavailable until the local Actual copy is available.');
  if (mirror.status === 'rejected') result.issues.push('Recurring payment schedules are unavailable.');
  result.paymentItems = buildPaymentCatalog({
    schedules: meta?.schedules || [], payees: meta?.payees || [],
    occurrences: retained.status === 'fulfilled' ? retained.value : result.recurring,
  });
  try { result.paymentOrganization = await readPaymentOrganization(userId, budgetId, result.paymentItems); }
  catch { result.issues.push('Saved payment groups are temporarily unavailable. Reload Payments to try again.'); }
  return result;
}
