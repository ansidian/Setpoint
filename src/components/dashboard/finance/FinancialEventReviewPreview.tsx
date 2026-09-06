import { Link } from "react-router";
import { CircleAlert } from "lucide-react";
import { useFinancialEventReview } from "../../../hooks/useFinancialEventReview";
import { financialReviewHref } from "../../../lib/financialReviewApi";

export default function FinancialEventReviewPreview() {
  const review = useFinancialEventReview();
  return <section className="dashboard-finance-card" aria-label="Financial emails">
    <div className="dashboard-finance-heading">
      <h3><CircleAlert size={15} />Financial emails{review.data ? ` · ${review.data.total}` : ""}</h3>
      <Link className="dashboard-finance-button" to={financialReviewHref()}>Open queue</Link>
    </div>
    {review.error && <p role="status" className="dashboard-finance-note">Couldn’t refresh the financial queue. <button type="button" className="dashboard-finance-button" onClick={review.refresh}>Retry</button></p>}
    {!review.data && review.loading && <p className="dashboard-finance-note">Loading financial records…</p>}
    {review.data?.total === 0 && <p className="dashboard-finance-note">No financial emails are waiting for details or another check.</p>}
    {review.data?.items.slice(0, 3).map((item) => <Link key={item.id} className="dashboard-finance-row" to={financialReviewHref(item.emailUid)}>
      <span className="min-w-0"><span className="dashboard-finance-row-title">{item.payee || item.subject || "Financial email"}</span><span className="dashboard-finance-row-detail">{item.reason}</span></span>
      <span className="dashboard-finance-caption">{item.attention === "complete_details" ? "Complete record" : item.attention === "check_actual" ? "Check Actual" : "Retrying"}</span>
    </Link>)}
    {review.data && review.data.total > 3 && <p className="dashboard-finance-note">Showing 3 of {review.data.total} records.</p>}
  </section>;
}
