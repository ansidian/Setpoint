import { amountConditionBounds } from "../actual/actual.ts";
import type { ActualMetadata, ActualSchedule } from "../../shared/types/actual.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";

/** Days between an email's financial date and a schedule's posting that still describe one occurrence. */
export const SCHEDULE_COVERAGE_WINDOW_DAYS = 3;

export interface ScheduleCoverage {
  scheduleId: string;
  name: string;
  /** Actual already posted the occurrence, or will post it on `date`. */
  state: "posted" | "pending_post";
  date: string;
}

// Words shared by unrelated schedules and receipts; they cannot establish identity.
const GENERIC = new Set(["payment", "payments", "card", "credit", "debit", "bill", "bills", "service", "services", "inc", "llc", "pbc",
  "the", "your", "and", "for", "autopay", "account", "online", "statement", "subscription", "membership", "com"]);

function identityTokens(...values: unknown[]): Set<string> {
  return new Set(values.flatMap(value => typeof value === "string" ? value.toLowerCase().split(/[^a-z0-9]+/) : [])
    .filter(token => token.length >= 3 && !GENERIC.has(token)));
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

// Statements and bills maintain schedules; refunds and rewards are not scheduled charges.
const NEVER_COVERED = new Set(["statement_issued", "bill_issued", "refund", "reward"]);

/** Actual's `isapprox` amount tolerance is 7.5% of the scheduled amount. A scheduled-payment
 * notice matches exactly, so a changed amount still reaches the schedule update path. */
function amountMatches(schedule: ActualSchedule, cents: number, exact: boolean): boolean {
  const condition = schedule.conditions?.find(item => item.field === "amount");
  if (!condition) return false;
  const { lo, hi } = amountConditionBounds(condition);
  const min = Math.min(Math.abs(lo), Math.abs(hi));
  const max = Math.max(Math.abs(lo), Math.abs(hi));
  const tolerance = !exact && condition.op === "isapprox" ? Math.round(max * 0.075) : 0;
  return cents >= min - tolerance && cents <= max + tolerance;
}

/**
 * Finds the Actual schedule that already accounts for an email's money movement.
 * Statements, bills, refunds and rewards are never covered. Requires the same schedule kind, a shared distinctive name/payee token, a matching
 * amount (an exactly dated scheduled-payment notice may omit it), and either a
 * posted schedule transaction or the upcoming occurrence near the email's date.
 */
export function findScheduleCoverage(candidate: BillCandidate, metadata: Pick<ActualMetadata, "schedules" | "payees" | "recentTransactions">,
  fallbackDate: string | null): ScheduleCoverage | null {
  const date = candidate.due_date || fallbackDate;
  if (!date || NEVER_COVERED.has(String(candidate.event_kind))) return null;
  const scheduledPayment = candidate.event_kind === "payment_scheduled";
  // A purchase is never a card-payment transfer, even when names overlap.
  const scheduleType = candidate.type === "income" ? "income" : candidate.type === "transfer" ? "transfer" : "bill";
  const amount = Number(candidate.amount);
  const cents = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
  const candidateTokens = identityTokens(candidate.payee, candidate.payee_hint, candidate.account_hint, candidate.account_last4);
  if (!candidateTokens.size) return null;
  const payeeNames = new Map((metadata.payees || []).map(payee => [payee.id, payee.name]));
  for (const schedule of metadata.schedules || []) {
    if (!schedule.id || (schedule.type || "bill") !== scheduleType) continue;
    const payeeId = schedule.conditions?.find(item => item.field === "payee")?.value;
    const scheduleTokens = identityTokens(schedule.name, typeof payeeId === "string" ? payeeNames.get(payeeId) : null);
    if (![...candidateTokens].some(token => scheduleTokens.has(token))) continue;
    const datedScheduledPayment = cents === null && scheduledPayment && schedule.next_date === date;
    if (!datedScheduledPayment && (cents === null || !amountMatches(schedule, cents, scheduledPayment))) continue;
    const name = schedule.name || payeeNames.get(String(payeeId)) || "Scheduled transaction";
    const posted = (metadata.recentTransactions || []).find(transaction => transaction.scheduleId === schedule.id
      && daysApart(transaction.date, date) <= SCHEDULE_COVERAGE_WINDOW_DAYS);
    if (posted) return { scheduleId: schedule.id, name, state: "posted", date: posted.date };
    if (!schedule.completed && schedule.next_date && daysApart(schedule.next_date, date) <= SCHEDULE_COVERAGE_WINDOW_DAYS) {
      return { scheduleId: schedule.id, name, state: "pending_post", date: schedule.next_date };
    }
  }
  return null;
}

export function describeScheduleCoverage(coverage: ScheduleCoverage): string {
  return coverage.state === "posted"
    ? `Covered by Actual schedule "${coverage.name}" (posted ${coverage.date}).`
    : `Covered by Actual schedule "${coverage.name}" (Actual posts it on ${coverage.date}).`;
}
