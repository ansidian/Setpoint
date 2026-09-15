import { moneyAhead } from "./moneyAheadModel";
import { useState } from "react";
import { ChevronDown, Clock, Wallet } from "lucide-react";
import { formatAmount } from "../../../lib/bill-utils";
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
  const { dueToday, pastDue, future, upcoming, amountsKnown, total, pastDueAmountsKnown, pastDueTotal } = moneyAhead(bills);
  const hasBills = upcoming.length + pastDue.length > 0;
  const unavailable = !health?.lastSuccessAt && health?.state !== "current";
  const renderBill = (bill: NeedsYouBill) => (
    <button type="button" className="dashboard-finance-row" data-dashboard-detail-trigger="true" key={`${bill.scheduleId || bill.id}:${bill.next_date}`} onClick={(event) => onOpen(bill, event.currentTarget)}>
      <span><span className="dashboard-finance-row-title">{bill.name || bill.payee || "Scheduled bill"}</span><span className="dashboard-finance-row-detail">{bill.next_date && new Date(`${bill.next_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</span></span>
      <span className="dashboard-finance-amount">{typeof bill.amount === "number" && Number.isFinite(bill.amount) ? formatAmount(Math.abs(bill.amount)) : "Amount unknown"}</span>
    </button>
  );
  return <section data-dashboard-detail-region="true" className="dashboard-finance-card money-ahead-card" aria-label="Money ahead">
    <div className="dashboard-finance-heading">
      <h3><Wallet size={15} />Money Ahead</h3>
      {configured && hasBills && <div className="money-ahead-statuses">
        {dueToday.length > 0 && <span className="money-ahead-status"><Clock size={14} aria-hidden="true" />{dueToday.length} due today</span>}
        {pastDue.length > 0 && <span className="money-ahead-status money-ahead-status-past">{pastDue.length} past due date</span>}
      </div>}
    </div>
    {!configured ? <p className="dashboard-finance-note">Connect Actual Budget in Settings to see scheduled obligations.</p>
      : loading && !hasBills ? <p className="dashboard-finance-note">Loading scheduled obligations…</p>
      : unavailable && !hasBills ? <p className="dashboard-finance-note">Scheduled obligations are unavailable until Actual syncs.</p>
      : <>
        <div className="dashboard-finance-caption">Today + next 7 days</div>
        <div className="dashboard-finance-value">{amountsKnown ? formatAmount(total) : "Amount incomplete"}</div>
        <div className="dashboard-finance-period"><strong>{upcoming.length}</strong>{" "}<span>upcoming {upcoming.length === 1 ? "obligation" : "obligations"}</span></div>
        <p className="dashboard-finance-scope">Excludes transfers</p>
        {health?.state !== "current" && <p className="dashboard-finance-note">Showing the last available schedule data.</p>}
        {dueToday.length > 0 && <div className="money-ahead-group money-ahead-group-today">
          <h4>Due today</h4>
          {dueToday.map(renderBill)}
        </div>}
        {pastDue.length > 0 && <div className="money-ahead-group">
          <div className="money-ahead-group-heading">
            <h4>Past due date</h4>
            <span className="dashboard-finance-amount">{pastDueAmountsKnown ? formatAmount(pastDueTotal) : "Amount incomplete"}</span>
          </div>
          <p className="dashboard-finance-note">Previous 30 days · not recorded in Actual</p>
          {pastDue.map(renderBill)}
        </div>}
        {future.length > 0 && <div className="money-ahead-group">
          <h4>Next 7 days</h4>
          {future.slice(0, 3).map(renderBill)}
          <AnimatedCollapse open={expanded}>{future.slice(3).map(renderBill)}</AnimatedCollapse>
          {future.length > 3 && <button type="button" className="dashboard-finance-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : `View ${future.length - 3} more`}<ChevronDown size={12} /></button>}
        </div>}
      </>}
  </section>;
}
