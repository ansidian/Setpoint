import { runActualWorkerOperation } from "./actual-worker.js";
import { testActualConnectionHttp } from "./actual-connection-test.js";

const METADATA_TTL_MS = 5 * 60 * 1000;
let metadataCache = { data: null, ts: 0 };

function amountConditionCents(condition) {
  const rawAmt = condition?.value;
  return typeof rawAmt === "object" && rawAmt !== null
    ? (rawAmt.num1 ?? 0)
    : (rawAmt ?? 0);
}

function scheduleAmountCents(schedule) {
  return amountConditionCents(schedule.conditions?.find(c => c.field === "amount"));
}

function schedulePayeeName(schedule, payeeMap) {
  const payeeCond = schedule.conditions?.find((c) => c.field === "payee");
  return payeeCond ? payeeMap[payeeCond.value] : schedule.name;
}

function baseBillFromSchedule(schedule, payeeMap) {
  const amountCents = scheduleAmountCents(schedule);
  const payeeName = schedulePayeeName(schedule, payeeMap);
  return {
    scheduleId: schedule.id,
    name: schedule.name || payeeName || "Unknown",
    payee: payeeName || schedule.name || "Unknown",
    amount: Math.abs(amountCents) / 100,
    type: schedule.type || "bill",
  };
}

function isBillLikeSchedule(schedule) {
  return !schedule?.completed && schedule?.type !== "income";
}

function isWithinDateRange(date, { start, end }) {
  return !!date && date >= start && date <= end;
}

function daysBetweenYmd(a, b) {
  const ms = new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function isSchedulePaid(schedule, recentTransactions) {
  if (!schedule.next_date) return false;
  const payeeCond = schedule.conditions?.find(c => c.field === "payee");
  const payeeId = payeeCond?.value;
  const amount = Math.abs(scheduleAmountCents(schedule)) / 100;
  return recentTransactions.some(t => {
    const dayDiff = Math.abs(daysBetweenYmd(t.date, schedule.next_date));
    if (t.scheduleId && t.scheduleId === schedule.id) return dayDiff <= 14;
    if (!payeeId || t.payeeId !== payeeId) return false;
    if (Math.abs(t.amount - amount) > 0.01) return false;
    return dayDiff <= 3;
  });
}

function mapOpenBillInstances(schedules, payeeMap, range) {
  return schedules
    .filter(isBillLikeSchedule)
    .filter((schedule) => isWithinDateRange(schedule.next_date, range))
    .map((schedule) => {
      const paid = isSchedulePaid(schedule, range.recentTransactions || []);
      return {
        ...baseBillFromSchedule(schedule, payeeMap),
        id: `${schedule.id}:${schedule.next_date}`,
        next_date: schedule.next_date,
        paid,
        openActionDisabled: paid,
      };
    })
    .sort((a, b) => a.next_date.localeCompare(b.next_date));
}

function shouldUseInProcessActual() {
  return process.env.NODE_ENV === "test" || process.env.EA_ACTUAL_WORKER_DISABLED === "1";
}

async function callActual(operation, args) {
  if (shouldUseInProcessActual()) {
    const core = await import("./actual-core.js");
    return core[operation](...args);
  }
  return runActualWorkerOperation(operation, args);
}

function clearMetadataCache() {
  metadataCache = { data: null, ts: 0 };
}

export function testConnection(userId, overrides = null) {
  return testActualConnectionHttp(userId, overrides);
}

export async function getMetadata(userId) {
  if (shouldUseInProcessActual()) return callActual("getMetadata", [userId]);
  const now = Date.now();
  if (metadataCache.data && now - metadataCache.ts < METADATA_TTL_MS) {
    return metadataCache.data;
  }
  const data = await callActual("getMetadata", [userId]);
  metadataCache = { data, ts: Date.now() };
  return data;
}

export async function getAccounts(userId) {
  const { accounts } = await getMetadata(userId);
  return accounts;
}

export async function getRecentTransactions(userId) {
  const { recentTransactions } = await getMetadata(userId);
  return recentTransactions;
}

export async function getPayees(userId) {
  const { payees } = await getMetadata(userId);
  return payees;
}

export async function getCategories(userId) {
  const { categories } = await getMetadata(userId);
  return categories;
}

export function getUpcomingBills(userId) {
  return callActual("getUpcomingBills", [userId]);
}

export function getCalendarBillsRange(userId, range) {
  return callActual("getCalendarBillsRange", [userId, range]);
}

export async function markBillPaid(scheduleId, userId) {
  const result = await callActual("markBillPaid", [scheduleId, userId]);
  clearMetadataCache();
  return result;
}

export async function sendBill(billData, userId) {
  const result = await callActual("sendBill", [billData, userId]);
  clearMetadataCache();
  return result;
}

export async function createQuickTxn(userId, payload) {
  const result = await callActual("createQuickTxn", [userId, payload]);
  clearMetadataCache();
  return result;
}

export const __testing__ = {
  mapOpenBillInstances,
};
