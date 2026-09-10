import { ChartNoAxesCombined, RefreshCw } from "lucide-react";
import type { DashboardSpendingSnapshot } from "../../../../shared/types/dashboard-finance";
import { formatAmount } from "../../../lib/bill-utils";

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function SpendingSnapshotCard({ spending, loading, onOpen }: {
  spending?: DashboardSpendingSnapshot;
  loading: boolean;
  onOpen: () => void;
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
        <div className="dashboard-finance-period"><time dateTime={current.start}>{dateLabel(current.start)}</time><span>–</span><time dateTime={current.end}>{dateLabel(current.end)}</time></div>
        <p className="dashboard-finance-scope">Expense outflows, excluding transfers</p>
        {previous?.total != null && <div className="dashboard-finance-comparison">
          {comparable && <div className="dashboard-finance-change"><strong>{formatAmount(Math.abs(change!))} {change! < 0 ? "less" : change! > 0 ? "more" : "change"}</strong>{spending.changePercent != null && <span>({Math.abs(spending.changePercent).toFixed(1)}%)</span>}</div>}
          <dl className="dashboard-finance-baseline"><div><dt><time dateTime={previous.start}>{dateLabel(previous.start)}</time>–<time dateTime={previous.end}>{dateLabel(previous.end)}</time></dt><dd>{formatAmount(previous.total)}</dd></div></dl>
        </div>}
        {spending.previousPeriodClamped && <p className="dashboard-finance-note">Last month was shorter; totals cover different numbers of days.</p>}
        {spending.syncState && spending.syncState !== "current" && <p className="dashboard-finance-note dashboard-finance-error">Actual data may be out of date.</p>}
        {spending.categories.map((category) => <div key={category.label} className="dashboard-finance-category">
          <span>{category.label}</span><span className="dashboard-finance-amount">{formatAmount(category.amount)}</span>
          <div className="dashboard-finance-track" aria-hidden="true"><span style={{ width: `${current.total! > 0 ? Math.min(100, category.amount / current.total! * 100) : 0}%` }} /></div>
        </div>)}
        <footer className="dashboard-finance-footer"><button type="button" className="dashboard-finance-button" onClick={onOpen}>Recent transactions</button>
          {spending.lastSyncedAt && <span className="dashboard-finance-freshness"><RefreshCw size={12} aria-hidden="true"/><span>Actual synced <time dateTime={spending.lastSyncedAt}>{new Date(spending.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></span></span>}
        </footer>
      </>}
  </section>;
}
