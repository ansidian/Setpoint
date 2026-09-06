import { useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import { daysUntil, formatAmount } from "../../../lib/bill-utils";
import AnimatedCollapse from "../../shared/AnimatedCollapse";
import type { NeedsYouBill } from "../needsYou/needsYouModel";
import type { BillsMirrorHealth } from "../../../../shared/types/bills";

export default function MoneyAheadCard({ bills, loading, configured, health, onOpen }: {
  bills: NeedsYouBill[];
  loading: boolean;
  configured: boolean;
  health: BillsMirrorHealth | null;
  onOpen: (bill: NeedsYouBill, anchor: HTMLElement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const upcoming = (() => {
    const seen = new Set<string>();
    return bills.filter((bill) => {
      const days = daysUntil(bill.next_date);
      const key = `${bill.scheduleId || bill.id}:${bill.next_date}`;
      if (bill.paid || days == null || days < 1 || days > 7 || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => String(a.next_date).localeCompare(String(b.next_date)));
  })();
  const amountsKnown = upcoming.every((bill) => typeof bill.amount === "number" && Number.isFinite(bill.amount));
  const total = upcoming.reduce((sum, bill) => sum + Math.round(Math.abs(bill.amount || 0) * 100), 0) / 100;
  const unavailable = !health?.lastSuccessAt && health?.state !== "current";
  const renderBill = (bill: NeedsYouBill) => (
    <button type="button" className="dashboard-finance-row" key={`${bill.scheduleId || bill.id}:${bill.next_date}`} onClick={(event) => onOpen(bill, event.currentTarget)}>
      <span><span className="dashboard-finance-row-title">{bill.name || bill.payee || "Scheduled bill"}</span><span className="dashboard-finance-row-detail">{bill.next_date && new Date(`${bill.next_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</span></span>
      <span className="dashboard-finance-amount">{typeof bill.amount === "number" ? formatAmount(Math.abs(bill.amount)) : "Amount unknown"}</span>
    </button>
  );
  return <section className="dashboard-finance-card" aria-label="Money ahead">
    <div className="dashboard-finance-heading"><h3><Wallet size={15} />Money Ahead</h3><span className="dashboard-finance-caption">Next 7 days</span></div>
    {!configured ? <p className="dashboard-finance-note">Connect Actual Budget in Settings to see scheduled obligations.</p>
      : loading && !upcoming.length ? <p className="dashboard-finance-note">Loading scheduled obligations…</p>
      : unavailable && !upcoming.length ? <p className="dashboard-finance-note">Scheduled obligations are unavailable until Actual syncs.</p>
      : <>
        <div className="dashboard-finance-value">{amountsKnown ? formatAmount(total) : "Amount incomplete"}</div>
        <p className="dashboard-finance-note">{upcoming.length} upcoming {upcoming.length === 1 ? "obligation" : "obligations"} · Today’s bills are in Needs You</p>
        {health?.state !== "current" && <p className="dashboard-finance-note">Showing the last available schedule data.</p>}
        {upcoming.slice(0, 3).map(renderBill)}
        <AnimatedCollapse open={expanded}>{upcoming.slice(3).map(renderBill)}</AnimatedCollapse>
        {upcoming.length > 3 && <button type="button" className="dashboard-finance-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : `View all ${upcoming.length}`}<ChevronDown size={12} /></button>}
      </>}
  </section>;
}
