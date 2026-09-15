import { daysUntil } from "../../../lib/bill-utils";
import type { NeedsYouBill } from "../needsYou/needsYouModel";

function summarizeAmounts(bills: NeedsYouBill[]) {
  const amountsKnown = bills.every((bill) => typeof bill.amount === "number" && Number.isFinite(bill.amount));
  const total = bills.reduce((sum, bill) => sum + (typeof bill.amount === "number" && Number.isFinite(bill.amount)
    ? Math.round(Math.abs(bill.amount) * 100) : 0), 0) / 100;
  return { amountsKnown, total };
}

/** Outstanding expenses from the previous 30 days through seven days ahead. */
export function moneyAhead(bills: NeedsYouBill[]) {
  const seen = new Set<string>();
  const dueToday: NeedsYouBill[] = [];
  const pastDue: NeedsYouBill[] = [];
  const future: NeedsYouBill[] = [];
  const eligible = bills.filter((bill) => {
    const days = daysUntil(bill.next_date);
    const key = `${bill.scheduleId || bill.id}:${bill.next_date}`;
    if (bill.type === "transfer" || bill.type === "income" || bill.paid || days == null || days < -30 || days > 7 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(a.next_date).localeCompare(String(b.next_date)));
  for (const bill of eligible) {
    const days = daysUntil(bill.next_date)!;
    if (days === 0) dueToday.push(bill);
    else if (days < 0) pastDue.push(bill);
    else future.push(bill);
  }
  const upcoming = [...dueToday, ...future];
  const pastAmounts = summarizeAmounts(pastDue);
  return {
    dueToday, pastDue, future, upcoming,
    ...summarizeAmounts(upcoming),
    pastDueAmountsKnown: pastAmounts.amountsKnown,
    pastDueTotal: pastAmounts.total,
  };
}
