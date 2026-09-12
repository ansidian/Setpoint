import type { Client, Row } from '@libsql/client';
import db from '../db/connection.ts';
import { currencyValuesInText, hasVerbatimFinancialEvidence } from '../bills/bill-candidate-verification-service.ts';
import { hasExplicitDateForYmd, matchFinancialProfile, selectSemanticBillAmount } from '../bills/financial-email-planner.ts';
import { validateFinancialProfiles } from '../bills/financial-profiles.ts';
import type { ActualMetadata } from '../../shared/types/actual.ts';
import type { BillCandidate } from '../../shared/types/bills.ts';
import type { FinancialActivity, FinancialWriteEvidence } from '../../shared/types/financial-activity.ts';
import type { FinancialProfileConfiguration } from '../../shared/types/financial-profiles.ts';
import type { RecurringStatement } from '../../shared/types/finances.ts';

interface StatementContext {
  activities: FinancialActivity[];
  metadata: ActualMetadata | null;
  profiles: FinancialProfileConfiguration;
  dbClient?: Pick<Client, 'execute'>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function cents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const result = Math.round(value * 100);
  return Number.isSafeInteger(result) ? result : null;
}

/** Effective evidence can replace or remove an original schedule; never fall back through a correction. */
function savedSchedule(activity: FinancialActivity, budgetId: string, metadata: ActualMetadata | null): string | null {
  if (activity.identityConflict || activity.targetBindings.length > 1 || activity.correction && activity.correction.state !== 'completed') return null;
  const captured = object(activity.originalReceipts[0]?.input);
  const operation = object(captured.operation || captured);
  if (!activity.correction && operation.executor && operation.executor !== 'transfer_schedule') return null;
  const effective = object(activity.effectiveResult);
  const evidence = (activity.correction || Object.hasOwn(effective, 'evidence')
    ? effective.evidence : activity.originalReceipts[0]?.evidence || activity.targetBindings[0]) as FinancialWriteEvidence | null | undefined;
  if (!evidence || evidence.budgetId !== budgetId || !Array.isArray(evidence.objects)) return null;
  const primary = evidence.objects.filter(item => item.role === 'primary' && ['schedule', 'transaction'].includes(item.kind));
  if (primary.length !== 1 || primary[0]!.kind !== 'schedule') return null;
  const schedule = primary[0]!;
  if (!schedule.id || !schedule.after || schedule.after.tombstone || schedule.after.id !== schedule.id) return null;
  if (typeof effective.scheduleId === 'string' && effective.scheduleId !== schedule.id) return null;
  const entry = object(effective.entry);
  if ((entry.type || entry.kind) && (entry.type || entry.kind) !== 'transfer_schedule') return null;
  const current = metadata?.schedules.filter(item => item.id === schedule.id) || [];
  if (current.length > 1 || current.some(item => item.type !== 'transfer')) return null;
  return schedule.id;
}

function profileSchedule(source: Row, candidate: BillCandidate, budgetId: string, context: StatementContext): string | null {
  if (!context.metadata || context.profiles.budgetId !== budgetId) return null;
  const { profile } = matchFinancialProfile(context.profiles, {
    sourceIdentity: { senderAddress: String(source.sender) },
    email: { subject: String(source.subject), body: String(source.body) },
  }, candidate);
  if (!profile || profile.target.kind !== 'card_payment' || !profile.target.scheduleId) return null;
  return validateFinancialProfiles([profile], { budgetId, metadata: context.metadata }).valid ? profile.target.scheduleId : null;
}

function project(source: Row, candidate: BillCandidate, scheduleId: string, budgetId: string, activity: FinancialActivity | undefined): RecurringStatement {
  const body = `${String(source.subject)}\n${String(source.body)}`;
  const facts = candidate.statement_facts;
  const grounded = (value: unknown) => hasVerbatimFinancialEvidence(body, value);
  const nothingDue = facts?.no_payment_required === true && grounded(facts.no_payment_evidence)
    && /no payment (?:is )?required|nothing (?:is )?due|zero (?:balance|amount due)|(?:amount|balance|total) due\s*[:\s]*\$?0(?:\.00)?\b/i.test(facts.no_payment_evidence || '');
  const monetaryFact = (value: unknown, evidence: unknown) => {
    const amount = cents(value);
    return amount !== null && grounded(evidence) && currencyValuesInText(String(evidence)).some(item => cents(item) === amount) ? amount : null;
  };
  const amount = selectSemanticBillAmount(candidate);
  const amountCents = candidate.currency !== 'USD' ? null : nothingDue ? 0
    : amount?.kind === 'statement_balance' ? cents(amount.amount) : null;
  const due = date(candidate.due_date);
  const dueDate = due && hasExplicitDateForYmd(body, due) ? due : null;
  return {
    id: `managed:${String(source.email_uid)}`, scheduleId, budgetId, emailUid: String(source.email_uid),
    subject: String(source.subject), receivedAt: String(source.received_at),
    statementDate: grounded(facts?.statement_date_evidence) && hasExplicitDateForYmd(String(facts?.statement_date_evidence), facts?.statement_date)
      ? date(facts?.statement_date) : null,
    dueDate, amountCents, amountKind: 'statement_balance', nothingDue,
    creditCents: monetaryFact(facts?.account_credit, facts?.account_credit_evidence),
    newChargesCents: monetaryFact(facts?.new_charges, facts?.new_charges_evidence),
    carriedBalanceCents: monetaryFact(facts?.carried_balance, facts?.carried_balance_evidence),
    providerReference: candidate.provider_reference && grounded(candidate.provider_reference_evidence) ? candidate.provider_reference : null,
    activity: activity?.reference || null,
    paymentTransactionIds: [], paymentDate: null, recordedTotalCents: null, feeCents: null,
    issue: candidate.currency !== 'USD' ? 'A verified USD statement balance is unavailable.'
      : amountCents === null ? 'Statement balance is unavailable.' : !nothingDue && !dueDate ? 'Statement due date is unavailable.' : null,
  };
}

/** Saved statement facts only. Group membership never changes payment or automation authority. */
export async function readRecurringStatements(userId: string, budgetId: string, start: string, context: StatementContext) {
  const result = await (context.dbClient || db).execute({ sql: `WITH sources AS (
    SELECT d.id, d.email_uid, d.event_id, receipt.record_id AS receipt_id,
      CASE WHEN receipt.record_id IS NOT NULL THEN json_extract(saved.value, '$.candidate') ELSE d.candidate_json END AS candidate,
      COALESCE(json_extract(d.acquired_source_json, '$.subject'), e.subject, '') AS subject,
      COALESCE(json_extract(d.acquired_source_json, '$.body'), e.body_text, '') AS body,
      COALESCE(json_extract(d.acquired_source_json, '$.fromAddress'), e.from_address, '') AS sender,
      COALESCE(json_extract(d.acquired_source_json, '$.emailDate'), e.email_date_utc, '') AS received_at
    FROM ea_financial_documents d
    LEFT JOIN ea_email_index e ON e.user_id=d.user_id AND e.uid=d.email_uid
    LEFT JOIN ea_financial_events event ON event.user_id=d.user_id AND event.id=d.event_id
    LEFT JOIN ea_financial_original_receipts receipt ON receipt.user_id=d.user_id AND receipt.owner='event' AND receipt.record_id=d.event_id
    LEFT JOIN json_each(COALESCE(json_extract(receipt.input_json, '$.sources'),
      json_extract(receipt.input_json, '$.operation.sourceEvidence'), json_extract(receipt.input_json, '$.sourceEvidence'))) saved
      ON json_extract(saved.value, '$.emailUid')=d.email_uid
    WHERE d.user_id=? AND d.dismissed_at IS NULL AND event.dismissed_at IS NULL
      AND (receipt.record_id IS NOT NULL OR (d.status NOT IN ('ignored', 'pending', 'processing') AND d.processed_revision=d.revision))
  ), originals AS (
    SELECT *, row_number() OVER (PARTITION BY COALESCE(event_id, 'document:' || id) ORDER BY id) AS source_order
    FROM sources WHERE json_extract(candidate, '$.type')='transfer'
      AND json_extract(candidate, '$.event_kind')='statement_issued'
      AND COALESCE(json_extract(candidate, '$.document_role'), 'statement')='statement'
  ) SELECT * FROM originals WHERE source_order=1 AND julianday(received_at)>=julianday(?)
    ORDER BY received_at DESC, id DESC LIMIT 501`, args: [userId, start] });
  const statements: RecurringStatement[] = [];
  for (const source of result.rows.slice(0, 500)) {
    const candidate = JSON.parse(String(source.candidate)) as BillCandidate;
    if ([candidate.type_verification, candidate.event_verification].some(audit => audit?.status === 'failed')) continue;
    const matches = context.activities.filter(activity => activity.source === 'managed' && activity.emailUids.includes(String(source.email_uid)));
    if (matches.length > 1) continue;
    const activity = matches[0];
    const hasSavedIdentity = source.receipt_id !== null || !!activity?.originalReceipts.length
      || !!activity?.targetBindings.length || !!activity?.correction;
    const scheduleId = hasSavedIdentity ? activity && savedSchedule(activity, budgetId, context.metadata)
      : profileSchedule(source, candidate, budgetId, context);
    if (scheduleId) statements.push(project(source, candidate, scheduleId, budgetId, activity));
  }
  return { statements, cardScheduleIds: [...new Set(statements.map(statement => statement.scheduleId))], truncated: result.rows.length > 500 };
}
