import { amountConditionBounds, amountConditionCents } from "./actual-amount-condition.ts";
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

function schedulePayeeId(schedule: ActualSchedule): string | undefined {
  const value = schedule.conditions?.find((condition) => condition.field === "payee")?.value;
  return typeof value === "string" ? value : undefined;
}

function daysBetweenYmd(a: string, b: string): number {
  const ms = new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

export function isSchedulePaid(schedule: ActualSchedule, recentTransactions: ActualRecentTransaction[] = []): boolean {
  if (!schedule.next_date) return false;
  const payeeId = schedulePayeeId(schedule);
  const bounds = amountConditionBounds(scheduleAmountCondition(schedule));
  // Match anywhere in the [num1, num2] band for range schedules; a fixed
  // amount collapses to lo === hi, preserving the original +/-$0.01 behaviour.
  const lo = Math.abs(bounds.lo) / 100;
  const hi = Math.abs(bounds.hi) / 100;
  const bandLo = Math.min(lo, hi) - 0.01;
  const bandHi = Math.max(lo, hi) + 0.01;
  const nextDate = schedule.next_date;
  return recentTransactions.some((transaction) => {
    const dayDiff = Math.abs(daysBetweenYmd(transaction.date, nextDate));
    if (transaction.scheduleId && transaction.scheduleId === schedule.id) return dayDiff <= 14;
    if (!payeeId || transaction.payeeId !== payeeId) return false;
    const transactionAmount = transaction.amount ?? 0;
    if (transactionAmount < bandLo || transactionAmount > bandHi) return false;
    return dayDiff <= 3;
  });
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
