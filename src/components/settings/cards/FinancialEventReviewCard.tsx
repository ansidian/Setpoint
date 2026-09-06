import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useFinancialEventReview } from "../../../hooks/useFinancialEventReview";
import { financialReviewHref } from "../../../lib/financialReviewApi";
import { Button } from "../../ui/button";
import { SettingsCard } from "../settings-ui";
import FinancialRecordReview from "./financial-review/FinancialRecordReview";
import FinancialReviewNotificationsControl from "./financial-review/FinancialReviewNotificationsControl";

const actionClass = "hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none";
const stateLabel = { complete_details: "Details needed", check_actual: "Check Actual", retrying: "Retrying automatically" };

export default function FinancialEventReviewCard({ liveOperationsAvailable }: { liveOperationsAvailable: boolean }) {
  const [offset, setOffset] = useState(0);
  const [params] = useSearchParams();
  const emailUid = params.get("financialEmail") || "";
  const review = useFinancialEventReview(offset);
  const selected = review.data?.items.find((item) => item.emailUid === emailUid);
  return <SettingsCard id="financial-event-review" ready={!review.loading || Boolean(review.data)}
    title={`Financial emails${review.data ? ` · ${review.data.total}` : ""}`} icon={<CircleAlert size={18} />}
    description="New financial emails waiting for details, an automatic check, or review in Actual. Related receipts share one record."
    headerAction={<Button type="button" variant="ghost" size="sm" className={actionClass} disabled={review.loading} onClick={review.refresh}><RefreshCw size={13} />Refresh</Button>}>
    <FinancialReviewNotificationsControl />
    {emailUid && <FinancialRecordReview key={emailUid} emailUid={emailUid} subject={selected?.subject} liveOperationsAvailable={liveOperationsAvailable} />}
    {review.error && <p role="alert" className="mb-3 text-xs text-[var(--sp-cream)]">Couldn’t refresh the queue. {review.data ? "Showing the last available records. " : ""}Use Refresh to try again.</p>}
    {!review.data && review.loading && <p role="status" className="py-3 text-xs text-muted-foreground">Loading financial records…</p>}
    {review.data?.total === 0 && <p className="py-3 text-xs leading-relaxed text-muted-foreground">No financial emails are waiting. Records appear here when new arrivals need more details or another check.</p>}
    <div className="divide-y divide-white/10">
      {review.data?.items.map((item) => <div key={item.id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 break-words">
          <div className="text-xs font-medium text-foreground">{item.payee || item.subject || "Financial email"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{stateLabel[item.attention]}{item.relatedEmails > 1 ? ` · ${item.relatedEmails} related emails` : ""}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.reason}</p>
          {item.subject && item.payee && <p className="mt-1 text-[11px] text-muted-foreground">{item.subject}</p>}
        </div>
        <Link to={financialReviewHref(item.emailUid)} className={`inline-flex min-h-9 shrink-0 items-center self-start rounded-md px-3 text-xs font-medium text-primary outline-none transition-[background-color,transform] hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary ${actionClass}`}>
          {item.canComplete && item.attention === "complete_details" ? "Complete record" : "Open record"}
        </Link>
      </div>)}
    </div>
    {review.data && review.data.total > review.data.limit && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{review.data.items.length ? `${offset + 1}–${Math.min(offset + review.data.items.length, review.data.total)} of ${review.data.total}` : "No records on this page"}</span>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="ghost" className={actionClass} disabled={review.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
        <Button type="button" size="sm" variant="ghost" className={actionClass} disabled={review.loading || offset + 20 >= review.data.total} onClick={() => setOffset(offset + 20)}>Next</Button>
      </div>
    </div>}
    {review.data && offset > 0 && !review.data.items.length && <Button type="button" variant="ghost" className={actionClass} onClick={() => setOffset(0)}>Back to first page</Button>}
  </SettingsCard>;
}
