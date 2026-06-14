import { daysUntil } from "../../../lib/bill-utils";

export const PRIORITY_COLOR = {
  1: "#f38ba8",
  2: "#f9e2af",
  3: "#89b4fa",
};

// Total of unpaid bills due within `maxDays` Pacific-days from today. Computed
// over the FULL bills list — not the rail's sliced 4-row preview — so the
// "Next 7d" headline doesn't undercount when more bills are due than are shown.
export function sumBillsDueWithin(bills, maxDays) {
  return (bills || []).reduce((sum, b) => {
    const d = daysUntil(b.next_date);
    return d != null && d >= 0 && d <= maxDays && !b.paid ? sum + (b.amount || 0) : sum;
  }, 0);
}

export function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.max(0, (Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const days = hrs / 24;
  if (days < 7) return `${Math.round(days)}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
