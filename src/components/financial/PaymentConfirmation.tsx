import { useEffect, useRef } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatImportAmount } from './transactionImportReviewModel';

/** Shared review presentation; the source owner retains validation and submission. */
export default function PaymentConfirmation({ amountCents, account, payee, date, category, notes, splits }: {
  splits?: Array<{ amountCents: number; notes: string; category?: string }>;
  amountCents:number; account:string; payee:string; date:string; category?:string; notes?:string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const inflow = amountCents > 0;
  useEffect(() => {
    heading.current?.focus({ preventScroll:true });
    heading.current?.closest('.financial-detail')?.scrollTo({ top:0 });
  },[]);
  return <section aria-label="Confirm payment" className="financial-confirmation">
    <h3 ref={heading} tabIndex={-1} className="outline-none">Review before sending</h3>
    <div className="financial-confirmation-flow" data-direction={inflow ? 'inflow' : 'outflow'}>
      <div className="financial-confirmation-direction">{inflow ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}{inflow ? 'Money in' : 'Money out'}</div>
      <strong className="financial-confirmation-amount">{inflow ? '+' : ''}{formatImportAmount(amountCents)}</strong>
      <p>{inflow ? 'Into' : 'From'} <strong>{account}</strong></p>
      <dl><div><dt>{inflow ? 'From' : 'To'}</dt><dd>{payee}</dd></div><div><dt>Date</dt><dd>{date}</dd></div>
        {category && <div><dt>Category</dt><dd>{category}</dd></div>}
        {notes && <div><dt>Notes</dt><dd>{notes}</dd></div>}
      </dl>
      {splits && <div className="mt-4 border-t border-white/15 pt-3">
        <p className="text-xs font-medium">One transaction · {splits.length} splits</p>
        <dl className="financial-confirmation-splits">{splits.map((split, index) => <div key={index}><dt className="break-words">{split.notes || `Split ${index + 1}`}<span className="block text-[11px] font-normal">{split.category || 'No category'}</span></dt><dd>{formatImportAmount(split.amountCents)}</dd></div>)}</dl>
      </div>}
    </div>
  </section>;
}
