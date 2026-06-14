import { amountConditionBounds, amountConditionCents } from "./actual-amount-condition.js";

function scheduleAmountCondition(schedule) {
  return schedule.conditions?.find((condition) => condition.field === "amount");
}

function scheduleAmountCents(schedule) {
  return amountConditionCents(scheduleAmountCondition(schedule));
}

function schedulePayeeName(schedule, payeeMap = {}) {
  const payeeCondition = schedule.conditions?.find((condition) => condition.field === "payee");
  return payeeCondition ? payeeMap[payeeCondition.value] : schedule.name;
}

function schedulePayeeId(schedule) {
  return schedule.conditions?.find((condition) => condition.field === "payee")?.value;
}

function daysBetweenYmd(a, b) {
  const ms = new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function isSchedulePaid(schedule, recentTransactions = []) {
  if (!schedule.next_date) return false;
  const payeeId = schedulePayeeId(schedule);
  const bounds = amountConditionBounds(scheduleAmountCondition(schedule));
  // Match anywhere in the [num1, num2] band for range schedules; a fixed
  // amount collapses to lo === hi, preserving the original +/-$0.01 behaviour.
  const lo = Math.abs(bounds.lo) / 100;
  const hi = Math.abs(bounds.hi) / 100;
  const bandLo = Math.min(lo, hi) - 0.01;
  const bandHi = Math.max(lo, hi) + 0.01;
  return recentTransactions.some((transaction) => {
    const dayDiff = Math.abs(daysBetweenYmd(transaction.date, schedule.next_date));
    if (transaction.scheduleId && transaction.scheduleId === schedule.id) return dayDiff <= 14;
    if (!payeeId || transaction.payeeId !== payeeId) return false;
    if (transaction.amount < bandLo || transaction.amount > bandHi) return false;
    return dayDiff <= 3;
  });
}

export function isBillLikeSchedule(schedule) {
  return !schedule?.completed && schedule?.type !== "income";
}

export function isWithinDateRange(date, { start, end }) {
  return !!date && date >= start && date <= end;
}

export function filterBillSchedulesForRange(schedules = [], range) {
  return schedules
    .filter(isBillLikeSchedule)
    .filter((schedule) => (range ? isWithinDateRange(schedule.next_date, range) : true));
}

export function billOccurrenceFromSchedule(schedule, {
  payeeMap = {},
  recentTransactions = [],
} = {}) {
  const amountCents = scheduleAmountCents(schedule);
  const payeeName = schedulePayeeName(schedule, payeeMap);
  const paid = isSchedulePaid(schedule, recentTransactions);
  return {
    id: `${schedule.id}:${schedule.next_date}`,
    scheduleId: schedule.id,
    name: schedule.name || payeeName || "Unknown",
    payee: payeeName || schedule.name || "Unknown",
    amount: Math.abs(amountCents) / 100,
    next_date: schedule.next_date,
    paid,
    type: schedule.type || "bill",
    openActionDisabled: paid,
  };
}

export function buildBillOccurrencesFromSchedules(schedules = [], {
  payeeMap = {},
  recentTransactions = [],
  range,
} = {}) {
  return filterBillSchedulesForRange(schedules, range)
    .map((schedule) => billOccurrenceFromSchedule(schedule, { payeeMap, recentTransactions }))
    .sort((a, b) => a.next_date.localeCompare(b.next_date));
}
