import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Wallet } from 'lucide-react';
import type { FinancialActivity, FinancialActivityPage } from '../../../../shared/types/financial-activity';
import AnimatedCollapse from '../../shared/AnimatedCollapse';
import { financialHref } from '../../financial/financialNavigation';
import { activityAmount, activityFacts, activityOutcome, activityReviewReason } from '../../financial/financialActivityPresentation';

export default function FinancialActivityCard({ review, completed, loading, reviewError, completedError }: {
  review: FinancialActivityPage | null;
  completed: FinancialActivityPage | null;
  loading: boolean;
  reviewError: boolean;
  completedError: boolean;
}) {
  const [showCompleted,setShowCompleted] = useState(false);
  const row = (item: FinancialActivity) => <Link key={item.id} className="dashboard-finance-row dashboard-finance-review-row" to={financialHref({ view:item.status === 'completed' ? 'completed' : 'needs_attention' },item.reference)}>
    <span><span className="dashboard-finance-row-title">{item.payee || item.subject || 'Financial record'}</span>
      <span className="dashboard-finance-row-detail">{item.status === 'completed' ? `${activityOutcome(item)} · ${activityFacts(item).label}` : `${item.status === 'processing' ? 'Pending · ' : ''}${activityReviewReason(item)}`}</span>
    </span>
    <span className="dashboard-finance-row-end"><span className="dashboard-finance-amount" data-direction={(item.amountCents ?? 0) > 0 ? 'inflow' : 'outflow'}>{activityAmount(item)}</span>
      <span className="dashboard-finance-caption">{item.status === 'completed' ? 'View result' : item.status === 'processing' ? 'View progress' : item.correction ? 'Review correction' : item.actions.complete ? 'Review details' : 'Review record'}</span>
    </span>
  </Link>;
  return <section className="dashboard-finance-card dashboard-finance-review" aria-label="Finance review">
    <div className="dashboard-finance-heading"><h3><Wallet size={15} />Finance{review ? ` · ${review.attentionTotal} to review` : ''}</h3>
      <Link className="dashboard-finance-button" to={financialHref({ view:'needs_attention' })}>View all<span className="sr-only"> financial reviews</span></Link>
    </div>
    {reviewError && <p role="status" className="dashboard-finance-note dashboard-finance-error">Couldn’t refresh reviews.{review ? ' Showing the last available records.' : ' Try Refresh below.'}</p>}
    {!review && loading && <p className="dashboard-finance-note">Loading financial reviews…</p>}
    {review?.total === 0 && <p className="dashboard-finance-note">Nothing needs your review.</p>}
    {review?.items.slice(0,3).map(row)}
    {review && review.total > 3 && <p className="dashboard-finance-note">Showing 3 of {review.total} records.</p>}
    <div className="dashboard-finance-completed">
      <button type="button" className="dashboard-finance-completed-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted(value => !value)}><ChevronDown size={14} aria-hidden="true" />Completed activity</button>
      {completedError && <p role="status" className="dashboard-finance-note dashboard-finance-error">Couldn’t refresh completed activity.{completed ? ' Saved results are still shown.' : ' Try Refresh below.'}</p>}
      <AnimatedCollapse open={showCompleted}><div>
        {!completed && loading && <p className="dashboard-finance-note">Loading completed activity…</p>}
        {completed?.total === 0 && <p className="dashboard-finance-note">No completed activity yet.</p>}
        {completed?.items.slice(0,3).map(row)}
        <Link className="dashboard-finance-button" to={financialHref({ view:'completed' })}>View all completed activity</Link>
      </div></AnimatedCollapse>
    </div>
  </section>;
}
