import { ChartNoAxesCombined } from "lucide-react";
import type { DashboardSpendingSnapshot } from "../../../../shared/types/dashboard-finance";
import { formatAmount } from "../../../lib/bill-utils";

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function SpendingSnapshotCard({ spending, loading, onOpen }: {
  spending?: DashboardSpendingSnapshot;
  loading: boolean;
  onOpen: (date: string) => void;
}) {
  const current = spending?.current;
  const previous = spending?.previous;
  const change = spending?.changeAmount;
  const comparable = spending?.status === "ready" && !spending.previousPeriodClamped && change != null;
  return <section className="dashboard-finance-card" aria-label="Spending snapshot">
    <div className="dashboard-finance-heading"><h3><ChartNoAxesCombined size={15} />Spending Snapshot</h3><span className="dashboard-finance-caption">Month to date</span></div>
    {!spending && loading ? <p className="dashboard-finance-note">Loading spending…</p>
      : spending?.status !== "ready" || current?.total == null ? <p className="dashboard-finance-note">Spending is unavailable until transaction data can be read.</p>
      : <>
        <div className="dashboard-finance-value">{formatAmount(current.total)}</div>
        <p className="dashboard-finance-note">{dateLabel(current.start)}–{dateLabel(current.end)} · Expense outflows, excluding transfers</p>
        {previous?.total != null && <p className="dashboard-finance-note">
          {comparable ? <>{formatAmount(Math.abs(change!))} {change! < 0 ? "less" : change! > 0 ? "more" : "change"}{spending.changePercent == null ? "" : ` (${Math.abs(spending.changePercent).toFixed(1)}%)`} · </> : null}
          {dateLabel(previous.start)}–{dateLabel(previous.end)}: {formatAmount(previous.total)}
        </p>}
        {spending.previousPeriodClamped && <p className="dashboard-finance-note">Last month was shorter; totals cover different numbers of days.</p>}
        {spending.syncState && spending.syncState !== "current" && <p className="dashboard-finance-note dashboard-finance-error">Actual data may be out of date.</p>}
        {spending.categories.map((category) => <div key={category.label} className="dashboard-finance-category">
          <span>{category.label}</span><span className="dashboard-finance-amount">{formatAmount(category.amount)}</span>
          <div className="dashboard-finance-track" aria-hidden="true"><span style={{ width: `${current.total! > 0 ? Math.min(100, category.amount / current.total! * 100) : 0}%` }} /></div>
        </div>)}
        <button type="button" className="dashboard-finance-button" onClick={() => onOpen(current.start)}>View transactions</button>
        {spending.lastSyncedAt && <p className="dashboard-finance-note">Actual synced {new Date(spending.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
      </>}
  </section>;
}
