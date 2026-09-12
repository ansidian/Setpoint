import db from '../db/connection.ts';
import { readActualMetadataProjection } from '../actual/actual.ts';
import { readJournalRange } from '../actual/actual.ts';
import { readBillsMirrorRange } from '../bills/bills-service.ts';
import { financialActivityReader } from '../financial-activity/financial-activity.ts';
import { linkStatementPayment, hydrateLegacyOccurrencePayments } from './finance-statement-model.ts';
import { readUtilityStatements } from './finance-statement-sources.ts';
import { readRecurringStatements } from './recurring-statement-sources.ts';
import { financialProfilesFromSettingsRow } from '../bills/financial-profiles.ts';
import { buildPaymentCatalog, readRetainedPaymentSchedules } from './payment-catalog.ts';
import { readPaymentOrganization } from './payment-groups.ts';
import type { FinanceWorkspace, UtilityIdentity } from '../../shared/types/finances.ts';

export async function readFinanceWorkspace(userId: string): Promise<FinanceWorkspace> {
  const end = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const start = new Date(`${end}T00:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 1);
  const range = { start: start.toISOString().slice(0, 10), end };
  const settings = await db.execute({ sql: 'SELECT actual_budget_sync_id, financial_profiles_json, financial_profiles_revision FROM ea_settings WHERE user_id=?', args: [userId] });
  const budgetId = settings.rows[0]?.actual_budget_sync_id ? String(settings.rows[0].actual_budget_sync_id) : null;
  const result: FinanceWorkspace = { budgetId, ...range, utilities: [], recurring: [], updatedAt: null, issues: [], truncated: false };
  if (!budgetId) { result.issues.push('Connect Actual to see utility schedules and recorded payments.'); return result; }
  const membership = await db.execute({ sql: 'SELECT * FROM ea_finance_utilities WHERE user_id=? AND budget_id=? ORDER BY rowid', args: [userId, budgetId] });
  const identities: UtilityIdentity[] = membership.rows.map(row => ({ id: String(row.id), label: String(row.label), provider: String(row.provider), budgetId,
    payeeId: String(row.payee_id), sourceIdentityText: String(row.source_identity_text || ''), scheduleIds: JSON.parse(String(row.schedule_ids_json)), sourceSenders: JSON.parse(String(row.source_senders_json)) }));
  const lookahead = new Date(`${range.end}T00:00:00Z`); lookahead.setUTCMonth(lookahead.getUTCMonth() + 3);
  const [metadata, mirror, journal, activities, retained] = await Promise.allSettled([
    readActualMetadataProjection(userId), readBillsMirrorRange(userId, { start: range.start, end: lookahead.toISOString().slice(0, 10) }),
    readJournalRange(userId, { ...range, limit: 2000 }), financialActivityReader.forWorkspace(userId, range.start),
    readRetainedPaymentSchedules(userId),
  ]);
  const meta = metadata.status === 'fulfilled' ? metadata.value : null;
  const transactions = journal.status === 'fulfilled' ? journal.value.transactions : [];
  const occurrences = hydrateLegacyOccurrencePayments(mirror.status === 'fulfilled' ? mirror.value.schedules : [], transactions);
  if (journal.status === 'fulfilled') result.recordedHistory = journal.value;
  const records = activities.status === 'fulfilled' ? activities.value : [];
  result.actualBudgetUrl = mirror.status === "fulfilled" ? mirror.value.actualBudgetUrl : null;
  result.updatedAt = meta?.syncHealth.lastSuccessAt || null;
  result.truncated = (journal.status === 'fulfilled' && journal.value.truncated) || records.length >= 500;
  if (!meta) result.issues.push('Actual metadata is unavailable. Saved statement history remains readable.');
  if (journal.status === 'rejected') result.issues.push('Recorded payment links are unavailable until the local Actual copy is available.');
  if (activities.status === 'rejected') result.issues.push('Saved record links are temporarily unavailable.');
  if (mirror.status === 'rejected') result.issues.push('Recurring payment schedules are unavailable.');
  if (!identities.length) result.issues.push('No verified utility identities are configured for this budget.');
  const profiles = financialProfilesFromSettingsRow(settings.rows[0]);
  const [sources, cards] = await Promise.all([
    readUtilityStatements(userId, budgetId, range.start),
    readRecurringStatements(userId, budgetId, range.start, { activities: records, metadata: meta, profiles }).catch(() => {
      result.issues.push('Saved credit card statements are temporarily unavailable.');
      return { statements: [], cardScheduleIds: [], truncated: false };
    }),
  ]);
  result.truncated ||= sources.truncated;
  result.truncated ||= cards.truncated;
  result.recurringStatements = cards.statements;
  const usedSchedules = new Set<string>();
  for (const configured of identities) {
    const identity = { ...configured, scheduleIds: [...new Set([...configured.scheduleIds, ...(meta?.schedules || [])
      .filter(schedule => schedule.conditions?.some(condition => condition.field === 'payee' && condition.value === configured.payeeId))
      .flatMap(schedule => schedule.id ? [schedule.id] : [])])] };
    if (meta && !meta.payees.some(payee => payee.id === identity.payeeId)) result.issues.push(`${identity.label}: the configured payee is unavailable in this budget.`);
    identity.scheduleIds.forEach(id => usedSchedules.add(id));
    const projected = sources.statements.filter(statement => statement.utilityId === identity.id).map(statement => {
      const record = records.find(activity => activity.emailUids.includes(statement.emailUid));
      const occurrence = occurrences.find(item => identity.scheduleIds.includes(item.scheduleId) && item.next_date === statement.dueDate);
      let effective = { ...statement, paymentRecorded: statement.paymentRecorded || !!occurrence?.paid };
      const occurrencePayment = occurrence?.paymentTransactionIds?.length === 1 ? transactions.find(item => item.id === occurrence.paymentTransactionIds![0]) : null;
      if (occurrencePayment) effective = { ...effective, paymentTransactionIds:[occurrencePayment.id], paymentDate:occurrencePayment.date, recordedTotalCents:Math.abs(occurrencePayment.amountCents) };
      if (record) {
        effective = { ...effective, activity: record.reference };
        const corrected = record.effectiveResult as { entry?: { type?: string; amountCents?: number; date?: string } } | null;
        if (record.correction?.state === 'completed' && corrected?.entry?.type === 'bill') {
          effective = { ...effective, originalStatement: { amountCents: statement.amountCents, dueDate: statement.dueDate }, amountCents: corrected.entry.amountCents == null ? effective.amountCents : Math.abs(corrected.entry.amountCents),
            dueDate: corrected.entry.date || effective.dueDate };
        }
        const bound = record.targetBindings.filter(binding => binding.budgetId === budgetId).flatMap(binding => binding.objects)
          .filter(object => object.kind === 'transaction' && object.role === 'primary');
        const payment = bound.length === 1 ? transactions.find(transaction => transaction.id === bound[0]!.id && transaction.amountCents < 0) : null;
        if (payment) effective = { ...effective, paymentTransactionIds: [payment.id], paymentDate: payment.date, recordedTotalCents: Math.abs(payment.amountCents) };
      }
      return linkStatementPayment(effective, identity, transactions);
    }).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    result.utilities.push({ identity, statements: projected, occurrences: occurrences.filter(item => identity.scheduleIds.includes(item.scheduleId)) });
  }
  result.recurring = occurrences.filter(item => !usedSchedules.has(item.scheduleId));
  result.paymentItems = buildPaymentCatalog({
    budgetId, utilities: result.utilities.map(utility => utility.identity), schedules: meta?.schedules || [],
    occurrences: retained.status === 'fulfilled' ? retained.value : occurrences, payees: meta?.payees || [],
    profiles: profiles.profiles, cardScheduleIds: cards.cardScheduleIds,
  });
  try { result.paymentOrganization = await readPaymentOrganization(userId, budgetId, result.paymentItems); }
  catch { result.issues.push('Saved payment groups are temporarily unavailable. Reload Payments to try again.'); }
  return result;
}
