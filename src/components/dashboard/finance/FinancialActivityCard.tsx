import { CircleCheck, CircleAlert } from "lucide-react";
import type { DashboardFinanceActivity, DashboardFinanceActivityItem } from "../../../../shared/types/dashboard-finance";
import { timeAgo } from "../rails/railModel";

function amountLabel(item: DashboardFinanceActivityItem) {
  if (item.amountCents == null) return "Amount unknown";
  const amount = Math.abs(item.amountCents / 100);
  if (!item.currency) return `${amount.toFixed(2)} · currency unknown`;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: item.currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${item.currency || ""}`; }
}

export default function FinancialActivityCard({ activity, loading, onOpenReview }: {
  activity?: DashboardFinanceActivity;
  loading: boolean;
  onOpenReview: (item?: DashboardFinanceActivityItem, completed?: boolean) => void;
}) {
  const row = (item: DashboardFinanceActivityItem) => <button key={item.id} type="button" className="dashboard-finance-row" onClick={() => onOpenReview(item, ["added", "updated", "already_present"].includes(item.status))}>
    <span><span className="dashboard-finance-row-title">{item.payee || "Financial email"}</span><span className="dashboard-finance-row-detail">{item.description} · Updated {timeAgo(new Date(item.updatedAt).toISOString())}</span></span>
    <span className="dashboard-finance-amount">{amountLabel(item)}</span>
  </button>;
  return <div className="dashboard-finance-card dashboard-finance-activity">
    <section aria-label="Historical import review">
      <div className="dashboard-finance-heading"><h3><CircleAlert size={15} />Historical imports{activity?.status === "ready" && activity.reviewCount > 0 ? ` · ${activity.reviewCount}` : ""}</h3><button type="button" className="dashboard-finance-button" onClick={() => onOpenReview()}>Open review</button></div>
      {!activity && loading ? <p className="dashboard-finance-note">Loading financial activity…</p>
        : activity?.status !== "ready" ? <p className="dashboard-finance-note">Financial review is temporarily unavailable.</p>
        : activity.reviewCount === 0 ? <p className="dashboard-finance-note">No imports need your review.</p>
        : activity.review.map(row)}
      {activity?.status === "ready" && activity.reviewCount > activity.review.length && <p className="dashboard-finance-note">Showing {activity.review.length} of {activity.reviewCount} items needing review.</p>}
    </section>
    <section aria-label="Recent automation">
      <div className="dashboard-finance-heading"><h3><CircleCheck size={15} />Recent Automation</h3><button type="button" className="dashboard-finance-button" onClick={() => onOpenReview(undefined, true)}>View all</button></div>
      {!activity && loading ? <p className="dashboard-finance-note">Loading recorded outcomes…</p>
        : activity?.status !== "ready" ? <p className="dashboard-finance-note">Automation history is temporarily unavailable.</p>
        : activity.recent.length === 0 ? <p className="dashboard-finance-note">No recent automatic imports.</p>
        : activity.recent.map(row)}
    </section>
  </div>;
}
