import db from '../db/connection.ts';
import { readActualMetadataProjection } from '../actual/actual.ts';
import { readJournalRange } from '../actual/actual.ts';
import { readBillsMirrorRange } from '../bills/bills-service.ts';
import { financialActivityReader } from '../financial-activity/financial-activity.ts';
import { projectStatement, linkStatementPayment } from './finance-statement-model.ts';
import type { BillCandidate } from '../../shared/types/bills.ts';
import type { FinanceWorkspace, UtilityIdentity, UtilityStatement } from '../../shared/types/finances.ts';

export async function readFinanceWorkspace(userId: string): Promise<FinanceWorkspace> {
  const end = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const start = new Date(`${end}T00:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 1);
  const range = { start: start.toISOString().slice(0, 10), end };
  const settings = await db.execute({ sql: 'SELECT actual_budget_sync_id FROM ea_settings WHERE user_id=?', args: [userId] });
  const budgetId = settings.rows[0]?.actual_budget_sync_id ? String(settings.rows[0].actual_budget_sync_id) : null;
  const result: FinanceWorkspace = { budgetId, ...range, utilities: [], recurring: [], updatedAt: null, issues: [], truncated: false };
  if (!budgetId) { result.issues.push('Connect Actual to see utility schedules and recorded payments.'); return result; }
  const membership = await db.execute({ sql: 'SELECT * FROM ea_finance_utilities WHERE user_id=? AND budget_id=? ORDER BY rowid', args: [userId, budgetId] });
  const identities: UtilityIdentity[] = membership.rows.map(row => ({ id: String(row.id), label: String(row.label), provider: String(row.provider), budgetId,
    payeeId: String(row.payee_id), sourceIdentityText: String(row.source_identity_text || ''), scheduleIds: JSON.parse(String(row.schedule_ids_json)), sourceSenders: JSON.parse(String(row.source_senders_json)) }));
  const lookahead = new Date(`${range.end}T00:00:00Z`); lookahead.setUTCMonth(lookahead.getUTCMonth() + 3);
  const [metadata, mirror, journal, activities] = await Promise.allSettled([
    readActualMetadataProjection(userId), readBillsMirrorRange(userId, { start: range.start, end: lookahead.toISOString().slice(0, 10) }),
    readJournalRange(userId, { ...range, limit: 2000 }), financialActivityReader.forWorkspace(userId, range.start),
  ]);
  const meta = metadata.status === 'fulfilled' ? metadata.value : null;
  const occurrences = mirror.status === 'fulfilled' ? mirror.value.schedules : [];
  const transactions = journal.status === 'fulfilled' ? journal.value.transactions : [];
  const records = activities.status === 'fulfilled' ? activities.value : [];
  result.actualBudgetUrl = mirror.status === "fulfilled" ? mirror.value.actualBudgetUrl : null;
  result.updatedAt = meta?.syncHealth.lastSuccessAt || null;
  result.truncated = (journal.status === 'fulfilled' && journal.value.truncated) || records.length >= 500;
  if (!meta) result.issues.push('Actual metadata is unavailable. Saved statement history remains readable.');
  if (journal.status === 'rejected') result.issues.push('Recorded payment links are unavailable until the local Actual copy is available.');
  if (activities.status === 'rejected') result.issues.push('Saved record links are temporarily unavailable.');
  if (mirror.status === 'rejected') result.issues.push('Recurring payment schedules are unavailable.');
  if (!identities.length) result.issues.push('No verified utility identities are configured for this budget.');
  const sources = await db.execute({ sql: `SELECT d.email_uid,d.candidate_json,e.subject,e.body_text,e.from_address,e.email_date_utc
    FROM ea_financial_documents d JOIN ea_email_index e ON e.user_id=d.user_id AND e.uid=d.email_uid
    WHERE d.user_id=? AND d.candidate_json IS NOT NULL AND e.email_date_utc>=? ORDER BY e.email_date_utc DESC LIMIT 501`, args: [userId, range.start] });
  result.truncated ||= sources.rows.length > 500;
  const usedSchedules = new Set<string>();
  for (const configured of identities) {
    const identity = { ...configured, scheduleIds: [...new Set([...configured.scheduleIds, ...(meta?.schedules || [])
      .filter(schedule => schedule.conditions?.some(condition => condition.field === 'payee' && condition.value === configured.payeeId))
      .flatMap(schedule => schedule.id ? [schedule.id] : [])])] };
    if (meta && !meta.payees.some(payee => payee.id === identity.payeeId)) result.issues.push(`${identity.label}: the configured payee is unavailable in this budget.`);
    identity.scheduleIds.forEach(id => usedSchedules.add(id));
    const statements = new Map<string, UtilityStatement>();
    for (const source of sources.rows.slice(0, 500)) {
      if (!identity.sourceSenders.includes(String(source.from_address).toLowerCase())) continue;
      if (identity.sourceIdentityText && !`${source.subject} ${source.body_text}`.toLowerCase().includes(identity.sourceIdentityText)) continue;
      const uid = String(source.email_uid);
      try {
        const candidate = JSON.parse(String(source.candidate_json)) as BillCandidate;
        const statement = projectStatement({ id: `managed:${uid}`, utilityId: identity.id, emailUid: uid,
          subject: String(source.subject || ''), receivedAt: String(source.email_date_utc || ''), body: String(source.body_text || ''), candidate });
        if (!statement.issue || candidate.document_role === 'statement') statements.set(uid, statement);
      } catch { /* Invalid source facts cannot become a billed amount. */ }
    }
    const projected = [...statements.values()].map(statement => {
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
  return result;
}
