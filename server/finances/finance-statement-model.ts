import type { BillCandidate } from '../../shared/types/bills.ts';
import type { ActualBillOccurrence } from '../../shared/types/actual.ts';
import type { JournalTransaction, UtilityIdentity, UtilityStatement } from '../../shared/types/finances.ts';
import { hasVerbatimFinancialEvidence, currencyValuesInText } from '../bills/bill-candidate-verification-service.ts';
import { findBillPaymentAdjustment } from '../../shared/billPaymentAdjustments.ts';

const date = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
const cents = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;

/** Older retained paid mirrors lack IDs. Recover only an unambiguous exact schedule posting on that occurrence date. */
export function hydrateLegacyOccurrencePayments(occurrences: ActualBillOccurrence[], transactions: JournalTransaction[]): ActualBillOccurrence[] {
  return occurrences.map(occurrence => {
    if (!occurrence.paid || occurrence.paymentTransactionIds !== undefined || !occurrence.scheduleId
      || occurrences.filter(row => row.scheduleId === occurrence.scheduleId && row.next_date === occurrence.next_date).length !== 1) return occurrence;
    const matches = transactions.filter(row => row.scheduleId === occurrence.scheduleId && row.date === occurrence.next_date
      && !row.isChild && (occurrence.type === 'transfer' ? row.amountCents !== 0 : occurrence.type === 'income' ? row.amountCents > 0 : row.amountCents < 0));
    if (matches.length === 1) return { ...occurrence, paymentTransactionIds: [matches[0]!.id] };
    const [first, second] = matches;
    const reciprocalPair = occurrence.type === 'transfer' && matches.length === 2 && first && second
      && !first.isParent && !second.isParent && first.id !== second.id
      && first.transferId === second.id && second.transferId === first.id
      && first.amountCents === -second.amountCents && first.accountId && second.accountId && first.accountId !== second.accountId;
    return reciprocalPair ? { ...occurrence, paymentTransactionIds: [first.id, second.id] } : occurrence;
  });
}

export function projectStatement(input: { id: string; utilityId: string; emailUid: string; subject: string; receivedAt: string;
  body: string; candidate: BillCandidate | null }): UtilityStatement {
  const candidate = input.candidate;
  const facts = candidate?.statement_facts;
  const grounded = (evidence: unknown) => hasVerbatimFinancialEvidence(input.body, evidence);
  const validStatement = !!candidate && ['statement_issued', 'bill_issued'].includes(candidate.event_kind || '')
    && (!candidate.document_role || candidate.document_role === 'statement') && candidate.type === 'bill'
    && ![candidate.amount_verification, candidate.event_verification, candidate.type_verification].some(value => value?.status === 'failed');
  const nothingDue = validStatement && facts?.no_payment_required === true && grounded(facts.no_payment_evidence)
    && /no payment (?:is )?required|nothing (?:is )?due|zero (?:balance|amount due)|(?:amount|balance|total) due\s*[:\s]*\$?0(?:\.00)?\b/i.test(facts.no_payment_evidence || '');
  const monetaryFact = (value: unknown, evidence: unknown) => grounded(evidence) && currencyValuesInText(String(evidence)).some(amount => cents(amount) === cents(value)) ? cents(value) : null;
  const amountKind = candidate?.amount_kind || null;
  const amountCents = nothingDue ? 0 : validStatement && candidate?.currency === 'USD' && ['total_due', 'statement_balance'].includes(amountKind || '') ? cents(candidate?.amount) : null;
  return { id: input.id, utilityId: input.utilityId, emailUid: input.emailUid, subject: input.subject,
    receivedAt: input.receivedAt, statementDate: grounded(facts?.statement_date_evidence) ? date(facts?.statement_date) : null,
    dueDate: validStatement ? date(candidate?.due_date) : null, amountCents, amountKind,
    nothingDue, creditCents: monetaryFact(facts?.account_credit, facts?.account_credit_evidence),
    newChargesCents: monetaryFact(facts?.new_charges, facts?.new_charges_evidence),
    carriedBalanceCents: monetaryFact(facts?.carried_balance, facts?.carried_balance_evidence),
    providerReference: candidate?.provider_reference && grounded(candidate.provider_reference_evidence) ? candidate.provider_reference : null,
    activity: null, paymentTransactionIds: [], paymentDate: null, recordedTotalCents: null, feeCents: null,
    issue: !validStatement ? 'Source does not establish a utility statement.' : candidate?.currency !== 'USD' ? 'A verified USD amount is unavailable.'
      : amountCents == null ? 'Billed amount is unavailable.' : !nothingDue && !date(candidate?.due_date) ? 'Due date is unavailable.' : null };
}

/** Exact schedule postings on the evidenced due date are safe historical links.
 * A reused schedule alone or a same-payee amount never establishes association. */
export function linkStatementPayment(statement: UtilityStatement, identity: UtilityIdentity, transactions: JournalTransaction[]): UtilityStatement {
  if (statement.nothingDue || !statement.dueDate || statement.paymentTransactionIds.length > 1) return statement;
  const matches = transactions.filter(transaction => transaction.amountCents < 0 && !transaction.isChild && (statement.paymentTransactionIds.length === 1
    ? transaction.id === statement.paymentTransactionIds[0]
    : transaction.scheduleId && identity.scheduleIds.includes(transaction.scheduleId) && transaction.payeeId === identity.payeeId && transaction.date === statement.dueDate));
  if (matches.length !== 1) return statement;
  const payment = matches[0]!;
  const recordedTotalCents = Math.abs(payment.amountCents);
  const adjustment = findBillPaymentAdjustment(identity.provider);
  const feeCents = statement.amountCents != null && adjustment && recordedTotalCents === statement.amountCents + adjustment.amountCents
    ? adjustment.amountCents : recordedTotalCents === statement.amountCents ? 0 : null;
  return { ...statement, paymentRecorded:true, paymentTransactionIds: [payment.id], paymentDate: payment.date, recordedTotalCents, feeCents };
}
