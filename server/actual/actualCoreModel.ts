// Pure derivation over Actual data for SDK operations and schedule writes:
// schedule classification + matching, schedule-condition building, date helpers, and
// the metadata/bill projections. No @actual-app/api, no DB — the residual owns the SDK
// session lifecycle, the lock/cache singletons, and all IO.
import { amountConditionCents } from "./actual-amount-condition.ts";
import { buildBillOccurrencesFromSchedules, isSchedulePaid } from "./actual-bill-occurrences.ts";
import type {
  ActualAccount,
  ActualBillOccurrence,
  ActualCategoryGroup,
  ActualConfig,
  ActualDateRange,
  ActualMetadata,
  ActualPayee,
  ActualRecentTransaction,
  ActualSchedule,
  ActualScheduleCondition,
} from "../../shared/types/actual.ts";

interface RawSdkTransaction {
  id?: string;
  account?: string;
  payee?: string | null;
  amount?: number | null;
  date: string;
  schedule?: string | null;
}

interface MetadataProjectionInput {
  rawAccounts: ActualAccount[];
  rawPayees: ActualPayee[];
  groups: ActualCategoryGroup[];
  schedules: ActualSchedule[];
  recentTxns: RawSdkTransaction[];
}

export function actualSessionKey(config: ActualConfig): string {
  return JSON.stringify({
    serverURL: config.serverURL,
    password: config.password || "",
    syncId: config.syncId,
    dataDir: config.dataDir || "",
    localBudgetId: config.localBudgetId || "",
  });
}

export function classifySchedules(schedules: ActualSchedule[], rawPayees: Array<Pick<ActualPayee, "id" | "transfer_acct">>): ActualSchedule[] {
  const transferAccountsByPayee = new Map(
    rawPayees
      .filter((payee) => payee.transfer_acct && payee.id)
      .map((payee) => [payee.id!, payee.transfer_acct!] as const),
  );
  return schedules.map(s => {
    const payeeValue = s.conditions?.find(c => c.field === "payee")?.value;
    const payeeId = typeof payeeValue === "string" ? payeeValue : undefined;
    const amtCond = s.conditions?.find(c => c.field === "amount");
    const signedAmt = amountConditionCents(amtCond);
    let type: ActualSchedule["type"];
    if (payeeId && transferAccountsByPayee.has(payeeId)) type = "transfer";
    else if (signedAmt > 0) type = "income";
    else type = "bill";
    return {
      ...s,
      type,
      ...(type === "transfer" ? { transferAccountId: transferAccountsByPayee.get(payeeId!) || null } : {}),
    };
  });
}

export function buildDateCondition(oldConditions: ActualScheduleCondition[], newDueDate: string): ActualScheduleCondition {
  const dateCond = oldConditions.find(c => c.field === "date");
  if (dateCond && typeof dateCond.value === "object" && dateCond.value?.frequency) {
    if ((dateCond.value.interval ?? 0) > 1) {
      return dateCond; // Keep complex recurrence as-is
    }
    return { op: dateCond.op, field: "date", value: { ...dateCond.value, start: newDueDate } };
  }
  return { op: "is", field: "date", value: newDueDate };
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mapOpenBillInstances(schedules: ActualSchedule[], payeeMap: Record<string, string>, range: ActualDateRange): ActualBillOccurrence[] {
  return buildBillOccurrencesFromSchedules(schedules, {
    payeeMap,
    recentTransactions: range.recentTransactions || [],
    range,
  });
}

export function transactionSearchStart(schedules: ActualSchedule[]): string | null {
  const dates = schedules
    .map((schedule) => schedule.next_date)
    .filter((date): date is string => typeof date === "string" && date.length > 0)
    .sort();
  if (!dates.length) return null;
  return addDaysYmd(dates[0]!, -14);
}

// Map raw SDK transaction rows to the { payee, amount, date } shape for client-side
// bill cross-reference. Shared by the metadata projection and the calendar bill range.
export function mapRecentTransactions(rawTxns: RawSdkTransaction[], payeeMap: Record<string, string>): ActualRecentTransaction[] {
  return rawTxns
    .filter(t => t.payee && t.amount)
    .map(t => ({
      id: t.id,
      accountId: t.account || null,
      payee: t.payee ? payeeMap[t.payee] || "" : "",
      payeeId: t.payee,
      amount: Math.abs(t.amount ?? 0) / 100,
      date: t.date,
      scheduleId: t.schedule || null,
    }));
}

// Pure projection of the raw SDK metadata pulls (accounts, payees, category groups,
// schedules-with-conditions, recent transactions) into the cached metadata shape.
export function projectSdkMetadata({ rawAccounts, rawPayees, groups, schedules, recentTxns }: MetadataProjectionInput): ActualMetadata {
  const accounts = rawAccounts
    .filter(a => !a.closed)
    .map(a => ({ id: a.id, name: a.name, type: a.type }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const payees = rawPayees
    .filter(p => p.name && !p.transfer_acct)
    .map(p => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const payeeMap = Object.fromEntries(rawPayees.map(p => [p.id, p.name]));

  // Classify each schedule as bill / transfer / income so the calendar can
  // hide income (paychecks) and style transfers distinctly. Transfer payees
  // (Actual's special per-account payees) carry a non-null transfer_acct.
  const classifiedSchedules = classifySchedules(schedules, rawPayees);

  const categories = groups
    .filter(g => g.name !== "Internal")
    .map(g => ({
      group_name: g.name || "",
      categories: (g.categories || []).map(c => ({ id: c.id, name: c.name })),
    }));

  const recentTransactions = mapRecentTransactions(recentTxns, payeeMap);

  return { accounts, payees, payeeMap, categories, schedules: classifiedSchedules, recentTransactions };
}

// Pure projection of classified schedules into the upcoming-bills view: filters to
// non-income schedules due within the week, derives amount/payee/paid, and sorts by date.
export function mapUpcomingBills(
  schedules: ActualSchedule[],
  payeeMap: Record<string, string>,
  recentTransactions: ActualRecentTransaction[],
  { today, weekFromNow }: { today: string; weekFromNow: string },
): Array<{ id: string; name: string; payee: string; amount: number; next_date: string; isDueToday: boolean; isOverdue: boolean; paid: boolean; type: string }> {
  return schedules
    .filter((s): s is ActualSchedule & { next_date: string } => typeof s.next_date === "string" && s.next_date <= weekFromNow)
    .filter(s => s.type !== "income")
    .map(s => {
      const amtCond = (s.conditions || []).find(c => c.field === "amount");
      const payeeCond = (s.conditions || []).find(c => c.field === "payee");
      const amountCents = amountConditionCents(amtCond);
      const payeeName = payeeCond && typeof payeeCond.value === "string" ? payeeMap[payeeCond.value] : s.name;

      return {
        id: s.id || "",
        name: s.name || payeeName || "Unknown",
        payee: payeeName || s.name || "Unknown",
        amount: Math.abs(amountCents) / 100,
        next_date: s.next_date || "",
        isDueToday: s.next_date === today,
        isOverdue: s.next_date < today,
        paid: isSchedulePaid(s, recentTransactions),
        type: s.type || "bill",
      };
    })
    .sort((a, b) => a.next_date.localeCompare(b.next_date));
}
