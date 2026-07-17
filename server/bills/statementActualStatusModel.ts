import {
  conditionForFields,
  scheduleAmountMatches,
} from "../actual/scheduleMatchModel.ts";
import type { ActualMetadata, ActualScheduleCondition } from "../../shared/types/actual.ts";
import type { BillCandidate, BillsMirrorHealth, StatementActualEvidence, StatementActualStatus } from "../../shared/types/bills.ts";

interface StatementOccurrence {
  scheduleId: string;
  id?: string;
  name?: string;
  payee?: string;
  amount?: number;
  next_date?: string;
  paid?: boolean;
  type?: string;
}
interface StatementTransaction {
  id: string;
  date: string;
  amount: number;
  direction?: string;
  payee?: string;
  payeeId?: string | null;
  account?: string;
  accountId?: string | null;
  transferAccountId?: string | null;
}
type StatementMetadata = Partial<ActualMetadata>;
interface StatementSchedule {
  id?: string;
  name?: string | null;
  next_date?: string | null;
  completed?: boolean;
  type?: string;
  conditions?: ActualScheduleCondition[];
}

interface StatementStatusInput {
  bill?: BillCandidate | null;
  metadata?: Omit<StatementMetadata, "schedules"> & { schedules?: StatementSchedule[] };
  occurrences?: StatementOccurrence[];
  transactions?: StatementTransaction[];
  syncHealth?: Pick<BillsMirrorHealth, "state" | "lastSuccessAt" | "lastError"> | null;
  today?: string;
}

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scheduleIdentityMatches(
  schedule: StatementSchedule,
  bill: BillCandidate,
  metadata: { payeeMap?: Record<string, string> },
): boolean {
  const payeeId = conditionForFields(schedule.conditions || [], ["payee", "description"])?.value;
  const accountId = conditionForFields(schedule.conditions || [], ["account", "acct"])?.value;
  const expectedAccountId = bill.type === "transfer" ? bill.to_account_id : bill.account_id;
  if (bill.type === "transfer" && schedule.type !== "transfer") return false;
  if (bill.type === "bill" && schedule.type !== "bill") return false;
  if (bill.payee_id) {
    return payeeId === bill.payee_id && (!expectedAccountId || accountId === expectedAccountId);
  }

  const expectedName = normalizeIdentity(
    bill.type === "transfer" ? (bill.schedule_name || bill.payee) : bill.payee,
  );
  if (!expectedName) return false;
  const scheduleNames = [schedule.name, metadata.payeeMap?.[String(payeeId || "")]]
    .map(normalizeIdentity)
    .filter(Boolean);
  return scheduleNames.includes(expectedName)
    && (!expectedAccountId || accountId === expectedAccountId);
}

function scheduleAmountCondition(schedule: StatementSchedule) {
  return conditionForFields(
    schedule.conditions || [],
    ["amount"],
    ["is", "isapprox", "isbetween"],
  );
}

function statementAmountMatches(schedule: StatementSchedule, occurrence: StatementOccurrence | null, amountCents: number | null): boolean {
  if (amountCents == null) return true;
  if (
    occurrence?.amount != null
    && Math.round(Number(occurrence.amount) * 100) === amountCents
  ) {
    return true;
  }
  return scheduleAmountMatches(scheduleAmountCondition(schedule), amountCents);
}

function occurrenceForSchedule(occurrences: StatementOccurrence[], schedule: StatementSchedule, dueDate: string | null = null): StatementOccurrence | null {
  return occurrences.find((item) => (
    item.scheduleId === schedule.id && (!dueDate || item.next_date === dueDate)
  )) || null;
}

function scheduleEvidence(
  schedule: StatementSchedule,
  occurrence: StatementOccurrence | null,
  bill: BillCandidate,
  conflicts: string[] = [],
): StatementActualEvidence {
  return {
    kind: "schedule",
    scheduleId: schedule.id,
    name: occurrence?.name || schedule.name || bill.payee || undefined,
    dueDate: occurrence?.next_date || schedule.next_date || undefined,
    amount: occurrence?.amount ?? null,
    paid: !!occurrence?.paid,
    type: occurrence?.type || schedule.type || "bill",
    ...(conflicts.length ? { conflicts } : {}),
  };
}

function transactionIdentityMatches(transaction: StatementTransaction, bill: BillCandidate): boolean {
  if (bill.type === "transfer") {
    return transaction.accountId === bill.from_account_id
      && transaction.transferAccountId === bill.to_account_id;
  }
  if (bill.payee_id) {
    return transaction.payeeId === bill.payee_id
      && (!bill.account_id || transaction.accountId === bill.account_id);
  }
  if (bill.account_id && transaction.accountId !== bill.account_id) return false;
  const expectedPayee = normalizeIdentity(bill.payee);
  return !!expectedPayee
    && normalizeIdentity(transaction.payee) === expectedPayee;
}

function transactionEvidence(transaction: StatementTransaction): StatementActualEvidence {
  return {
    kind: "transaction",
    transactionId: transaction.id,
    name: transaction.payee || "Actual transaction",
    dueDate: transaction.date,
    amount: transaction.amount,
    account: transaction.account || "",
    type: transaction.direction || "expense",
  };
}

export function resolveStatementActualStatus({
  bill,
  metadata = {},
  occurrences = [],
  transactions = [],
  syncHealth = null,
  today = "",
}: StatementStatusInput = {}): StatementActualStatus {
  if (syncHealth?.state !== "current") {
    return {
      status: "unavailable",
      reason: "actual_data_not_current",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: null,
    };
  }

  if (!bill?.due_date) {
    return {
      status: "unavailable",
      reason: "insufficient_statement_evidence",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: null,
    };
  }

  const expectedAmountCents = bill.amount != null
    && Number.isFinite(Number(bill.amount))
    ? Math.round(Number(bill.amount) * 100)
    : null;
  if (bill.due_date <= today && expectedAmountCents != null) {
    const transactionMatches = transactions.filter((transaction) => (
      transaction.date === bill.due_date
      && Math.round(Number(transaction.amount) * 100) === expectedAmountCents
      && transactionIdentityMatches(transaction, bill)
    ));
    if (transactionMatches.length === 1) {
      return {
        status: "already_recorded",
        reason: "exact_transaction_match",
        checkedAt: syncHealth?.lastSuccessAt || null,
        evidence: transactionEvidence(transactionMatches[0]!),
      };
    }
    if (transactionMatches.length > 1) {
      return {
        status: "needs_review",
        reason: "ambiguous_transaction_match",
        checkedAt: syncHealth?.lastSuccessAt || null,
        evidence: {
          kind: "transaction_candidates",
          count: transactionMatches.length,
          transactionIds: transactionMatches.map((transaction) => transaction.id),
          conflicts: ["identity"],
        },
      };
    }
  }

  const schedules = (metadata.schedules || []).filter((schedule) => (
    !schedule.completed && schedule.type !== "income"
  ));
  const identityMatches = schedules.filter((schedule) => scheduleIdentityMatches(schedule, bill, metadata));
  const dateMatches = identityMatches.filter((schedule) => (
    schedule.next_date === bill.due_date
    || !!occurrenceForSchedule(occurrences, schedule, bill.due_date)
  ));
  const exactMatches = dateMatches.filter((schedule) => (
    statementAmountMatches(
      schedule,
      occurrenceForSchedule(occurrences, schedule, bill.due_date),
      expectedAmountCents,
    )
  ));
  if (exactMatches.length > 1) {
    return {
      status: "needs_review",
      reason: "ambiguous_schedule_match",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: {
        kind: "schedule_candidates",
        count: exactMatches.length,
        scheduleIds: exactMatches.map((schedule) => schedule.id).filter((id): id is string => !!id),
        conflicts: ["identity"],
      },
    };
  }
  const matchingSchedule = exactMatches[0] || null;
  const occurrence = matchingSchedule
    ? occurrenceForSchedule(occurrences, matchingSchedule, bill.due_date)
    : null;

  if (matchingSchedule && occurrence) {
    return {
      status: "already_scheduled",
      reason: "exact_schedule_match",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: scheduleEvidence(matchingSchedule, occurrence, bill),
    };
  }

  if (dateMatches.length) {
    const schedule = dateMatches[0]!;
    return {
      status: "needs_review",
      reason: "amount_mismatch",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: scheduleEvidence(
        schedule,
        occurrenceForSchedule(occurrences, schedule, bill.due_date),
        bill,
        ["amount"],
      ),
    };
  }

  if (identityMatches.length) {
    const schedule = identityMatches[0]!;
    return {
      status: "needs_review",
      reason: "due_date_mismatch",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: scheduleEvidence(
        schedule,
        occurrenceForSchedule(occurrences, schedule),
        bill,
        ["due_date"],
      ),
    };
  }

  return {
    status: "not_scheduled",
    reason: "no_match",
    checkedAt: syncHealth?.lastSuccessAt || null,
    evidence: null,
  };
}
