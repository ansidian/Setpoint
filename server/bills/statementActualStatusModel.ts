import {
  conditionForFields,
  scheduleAmountMatches,
} from "../actual/scheduleMatchModel.ts";
import { findBillPaymentAdjustment } from "../../shared/billPaymentAdjustments.ts";
import type { ActualMetadata, ActualScheduleCondition } from "../../shared/types/actual.ts";
import type { BillCandidate, BillsMirrorHealth, StatementActualEvidence, StatementActualStatus } from "../../shared/types/bills.ts";
import type { BillPaymentAdjustmentPolicy } from "../../shared/billPaymentAdjustments.ts";
import { scheduleAccountId, transferScheduleTopology } from "./financialEmailAccountEvidence.ts";

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
  transferAccountId?: string | null;
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
  if (bill.type === "transfer") {
    const topology = transferScheduleTopology(schedule);
    return Boolean(topology && topology.toAccountId === bill.to_account_id
      && topology.fromAccountId === bill.from_account_id);
  }
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

interface StatementAmountExpectation {
  amountCents: number | null;
  adjustment: BillPaymentAdjustmentPolicy | null;
}

function statementAmountExpectations(bill: BillCandidate): StatementAmountExpectation[] {
  const amountCents = bill.amount != null && Number.isFinite(Number(bill.amount))
    ? Math.round(Number(bill.amount) * 100)
    : null;
  if (amountCents == null) return [{ amountCents: null, adjustment: null }];

  const adjustment = findBillPaymentAdjustment(
    bill.payee,
    bill.payee_hint,
    bill.payee_label,
    bill.schedule_name,
  );
  return [
    { amountCents, adjustment: null },
    ...(adjustment ? [{ amountCents: amountCents + adjustment.amountCents, adjustment }] : []),
  ];
}

function statementAmountMatch(
  schedule: StatementSchedule,
  occurrence: StatementOccurrence | null,
  expectations: StatementAmountExpectation[],
): StatementAmountExpectation | null {
  if (expectations[0]?.amountCents == null) return expectations[0] || null;
  const occurrenceAmountCents = occurrence?.amount != null
    ? Math.round(Number(occurrence.amount) * 100)
    : null;
  return expectations.find((expectation) => (
    expectation.amountCents != null
    && (
      occurrenceAmountCents === expectation.amountCents
      || scheduleAmountMatches(scheduleAmountCondition(schedule), expectation.amountCents)
    )
  )) || null;
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
  amountMatch: StatementAmountExpectation | null = null,
): StatementActualEvidence {
  const adjustmentEvidence = amountMatch?.adjustment && bill.amount != null
    ? {
        statementAmount: Number(bill.amount),
        adjustment: {
          policyId: amountMatch.adjustment.policyId,
          kind: amountMatch.adjustment.kind,
          label: amountMatch.adjustment.label,
          amount: amountMatch.adjustment.amountCents / 100,
        },
      }
    : {};
  return {
    kind: "schedule",
    scheduleId: schedule.id,
    name: occurrence?.name || schedule.name || bill.payee || undefined,
    dueDate: occurrence?.next_date || schedule.next_date || undefined,
    amount: occurrence?.amount ?? null,
    paid: !!occurrence?.paid,
    type: occurrence?.type || schedule.type || "bill",
    ...adjustmentEvidence,
    ...(conflicts.length ? { conflicts } : {}),
  };
}

function transactionIdentityMatches(transaction: StatementTransaction, bill: BillCandidate): boolean {
  if (bill.type === "transfer") {
    return (transaction.direction === "expense" && transaction.accountId === bill.from_account_id
      && transaction.transferAccountId === bill.to_account_id)
      || (transaction.direction === "income" && transaction.accountId === bill.to_account_id
        && transaction.transferAccountId === bill.from_account_id);
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

function transactionEvidence(
  transaction: StatementTransaction,
  bill: BillCandidate,
  amountMatch: StatementAmountExpectation,
): StatementActualEvidence {
  const adjustmentEvidence = amountMatch.adjustment && bill.amount != null
    ? {
        statementAmount: Number(bill.amount),
        adjustment: {
          policyId: amountMatch.adjustment.policyId,
          kind: amountMatch.adjustment.kind,
          label: amountMatch.adjustment.label,
          amount: amountMatch.adjustment.amountCents / 100,
        },
      }
    : {};
  return {
    kind: "transaction",
    transactionId: transaction.id,
    name: transaction.payee || "Actual transaction",
    dueDate: transaction.date,
    amount: transaction.amount,
    account: transaction.account || "",
    type: transaction.direction || "expense",
    ...adjustmentEvidence,
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

  const amountExpectations = statementAmountExpectations(bill);
  const expectedAmountCents = amountExpectations[0]?.amountCents ?? null;
  if (bill.due_date <= today && expectedAmountCents != null) {
    const allTransactionMatches = transactions.flatMap((transaction) => {
      if (transaction.date !== bill.due_date || !transactionIdentityMatches(transaction, bill)) return [];
      const transactionAmountCents = Math.round(Number(transaction.amount) * 100);
      const amountMatch = amountExpectations.find((expectation) => (
        expectation.amountCents === transactionAmountCents
      ));
      return amountMatch ? [{ transaction, amountMatch }] : [];
    });
    // Actual exposes both legs of one transfer. Prefer the funding leg so its
    // destination mirror is not counted as another independent payment.
    const sourceMatches = bill.type === "transfer"
      ? allTransactionMatches.filter(({ transaction }) => transaction.direction === "expense") : [];
    const transactionMatches = sourceMatches.length ? sourceMatches : allTransactionMatches;
    if (transactionMatches.length === 1) {
      const match = transactionMatches[0]!;
      return {
        status: "already_recorded",
        reason: "exact_transaction_match",
        checkedAt: syncHealth?.lastSuccessAt || null,
        evidence: transactionEvidence(match.transaction, bill, match.amountMatch),
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
          transactionIds: transactionMatches.map(({ transaction }) => transaction.id),
          conflicts: ["identity"],
        },
      };
    }
  }

  const schedules = (metadata.schedules || []).filter((schedule) => (
    !schedule.completed && schedule.type !== "income"
  ));
  if (bill.type === "transfer") {
    const names = new Set([bill.schedule_name, bill.payee, bill.payee_hint,
      `${metadata.accounts?.find((account) => account.id === bill.to_account_id)?.name || ""} Payment`]
      .map(normalizeIdentity).filter(Boolean));
    const conflict = schedules.find((schedule) => {
      if (schedule.type !== "transfer" || !names.has(normalizeIdentity(schedule.name))) return false;
      if (scheduleAccountId(schedule) !== bill.to_account_id && schedule.transferAccountId !== bill.to_account_id) return false;
      const topology = transferScheduleTopology(schedule);
      return !topology || topology.toAccountId !== bill.to_account_id || topology.fromAccountId !== bill.from_account_id;
    });
    if (conflict) return {
      status: "needs_review", reason: "transfer_direction_mismatch", checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: scheduleEvidence(conflict, occurrenceForSchedule(occurrences, conflict, bill.due_date), bill, ["account", "transfer_direction"]),
    };
  }
  const identityMatches = schedules.filter((schedule) => scheduleIdentityMatches(schedule, bill, metadata));
  const dateMatches = identityMatches.filter((schedule) => (
    schedule.next_date === bill.due_date
    || !!occurrenceForSchedule(occurrences, schedule, bill.due_date)
  ));
  const exactMatches = dateMatches.flatMap((schedule) => {
    const occurrence = occurrenceForSchedule(occurrences, schedule, bill.due_date);
    const amountMatch = statementAmountMatch(
      schedule,
      occurrence,
      amountExpectations,
    );
    return amountMatch ? [{ schedule, occurrence, amountMatch }] : [];
  });
  if (exactMatches.length > 1) {
    return {
      status: "needs_review",
      reason: "ambiguous_schedule_match",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: {
        kind: "schedule_candidates",
        count: exactMatches.length,
        scheduleIds: exactMatches.map(({ schedule }) => schedule.id).filter((id): id is string => !!id),
        conflicts: ["identity"],
      },
    };
  }
  const matchingEntry = exactMatches[0] || null;
  const matchingSchedule = matchingEntry?.schedule || null;
  const occurrence = matchingEntry?.occurrence || null;

  if (matchingEntry && matchingSchedule && occurrence) {
    return {
      status: "already_scheduled",
      reason: "exact_schedule_match",
      checkedAt: syncHealth?.lastSuccessAt || null,
      evidence: scheduleEvidence(matchingSchedule, occurrence, bill, [], matchingEntry.amountMatch),
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
