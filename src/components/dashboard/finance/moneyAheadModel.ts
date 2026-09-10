import { daysUntil } from "../../../lib/bill-utils";
import type { NeedsYouBill } from "../needsYou/needsYouModel";

/** The unpaid expense obligations due today through seven days ahead. */
export function moneyAhead(bills: NeedsYouBill[]) {
  const seen = new Set<string>();
  const upcoming = bills.filter((bill) => {
    const days = daysUntil(bill.next_date);
    const key = `${bill.scheduleId || bill.id}:${bill.next_date}`;
    if (bill.type === "transfer" || bill.type === "income" || bill.paid || days == null || days < 0 || days > 7 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(a.next_date).localeCompare(String(b.next_date)));
  const amountsKnown = upcoming.every((bill) => typeof bill.amount === "number" && Number.isFinite(bill.amount));
  const total = upcoming.reduce((sum, bill) => sum + Math.round(Math.abs(bill.amount || 0) * 100), 0) / 100;
  return { upcoming, amountsKnown, total };
}
