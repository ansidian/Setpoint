import { amountConditionCents } from "./actual-amount-condition.ts";
import type {
  ActualBillOccurrence,
  ActualDateRange,
  ActualRecentTransaction,
  ActualSchedule,
  ActualScheduleCondition,
} from "../../shared/types/actual.ts";

interface BillOccurrenceOptions {
  payeeMap?: Record<string, string>;
  recentTransactions?: ActualRecentTransaction[];
}

interface BuildBillOccurrencesOptions extends BillOccurrenceOptions {
  range?: ActualDateRange;
}

function scheduleAmountCondition(schedule: ActualSchedule): ActualScheduleCondition | undefined {
  return schedule.conditions?.find((condition) => condition.field === "amount");
}

function scheduleAmountCents(schedule: ActualSchedule): number {
  return amountConditionCents(scheduleAmountCondition(schedule));
}

function schedulePayeeName(schedule: ActualSchedule, payeeMap: Record<string, string> = {}): string | null | undefined {
  const payeeCondition = schedule.conditions?.find((condition) => condition.field === "payee");
  return payeeCondition && typeof payeeCondition.value === "string" ? payeeMap[payeeCondition.value] : schedule.name;
}

/** Actual recognizes posted schedule transactions independently of clearing or amount. */
export function schedulePaymentTransactions(schedule: ActualSchedule, transactions: ActualRecentTransaction[] = [], historical = false): ActualRecentTransaction[] {
  if (!schedule.id || !schedule.next_date) return [];
  const exactDate = schedule.conditions?.some(condition => condition.field === 'date' && condition.op === 'is');
  const lower = new Date(`${schedule.next_date}T00:00:00Z`);
  if (!exactDate && !schedule.posts_transaction) lower.setUTCDate(lower.getUTCDate() - 2);
  const start = lower.toISOString().slice(0, 10);
  return transactions.filter(transaction => transaction.scheduleId === schedule.id && transaction.date >= start
    && (!historical || transaction.date <= schedule.next_date!));
}

export function isSchedulePaid(schedule: ActualSchedule, recentTransactions: ActualRecentTransaction[] = []): boolean {
  return schedulePaymentTransactions(schedule, recentTransactions).length > 0;
}

export function isBillLikeSchedule(schedule: ActualSchedule): boolean {
  return !schedule?.completed && schedule?.type !== "income";
}

export function isWithinDateRange(date: string | null | undefined, { start, end }: ActualDateRange): boolean {
  return !!date && date >= start && date <= end;
}

export function filterBillSchedulesForRange(schedules: ActualSchedule[] = [], range?: ActualDateRange): ActualSchedule[] {
  return schedules
    .filter(isBillLikeSchedule)
    .filter((schedule) => (range ? isWithinDateRange(schedule.next_date, range) : true));
}

export function billOccurrenceFromSchedule(schedule: ActualSchedule, {
  payeeMap = {},
  recentTransactions = [],
}: BillOccurrenceOptions = {}): ActualBillOccurrence {
  const amountCents = scheduleAmountCents(schedule);
  const payeeName = schedulePayeeName(schedule, payeeMap);
  const paid = isSchedulePaid(schedule, recentTransactions);
  return {
    id: `${schedule.id || ""}:${schedule.next_date || ""}`,
    scheduleId: schedule.id || "",
    name: schedule.name || payeeName || "Unknown",
    payee: payeeName || schedule.name || "Unknown",
    amount: Math.abs(amountCents) / 100,
    next_date: schedule.next_date || "",
    paid,
    paymentTransactionIds: schedulePaymentTransactions(schedule, recentTransactions).flatMap(transaction => transaction.id ? [transaction.id] : []),
    type: schedule.type || "bill",
    openActionDisabled: paid,
  };
}

export function buildBillOccurrencesFromSchedules(schedules: ActualSchedule[] = [], {
  payeeMap = {},
  recentTransactions = [],
  range,
}: BuildBillOccurrencesOptions = {}): ActualBillOccurrence[] {
  return filterBillSchedulesForRange(schedules, range)
    .map((schedule) => billOccurrenceFromSchedule(schedule, { payeeMap, recentTransactions }))
    .sort((a, b) => a.next_date.localeCompare(b.next_date));
}
