import Metadata from "../shared/Metadata";
import { useCallback, useEffect, useRef } from 'react';
import AnchoredFloatingPanel from '../shared/pickers/AnchoredFloatingPanel';
import AnimatedHeight from '../shared/AnimatedHeight';
import type { RefObject } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { MonthlyPaymentAmount } from './monthlyPaymentModel';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';

export default function PaymentMonthDetails({ selected, mobile, contentId, anchorRef, onClose, onNavigate }: {
  selected: MonthlyPaymentAmount; mobile: boolean; contentId: string; anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void; onNavigate: (target: FinanceDestination) => void;
}) {
  const contentRef = useRef<HTMLElement>(null);
  const scrollRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    // This region owns scrolling; the floating shell only contains its own wheel edges.
    const containWheel = (event: WheelEvent) => event.stopPropagation();
    element.addEventListener('wheel', containWheel, { passive:true });
    return () => element.removeEventListener('wheel', containWheel);
  }, []);
  useEffect(() => {
    if (mobile) return;
    const frame = requestAnimationFrame(() => contentRef.current?.focus({ preventScroll:true }));
    return () => cancelAnimationFrame(frame);
  }, [mobile]);
  const dismiss = () => { anchorRef.current?.focus({ preventScroll:true }); onClose(); };
  const monthLabel = new Date(`${selected.month}-01T12:00:00`).toLocaleDateString('en-US', { month:'long', year:'numeric' });
  const content = <section id={contentId} ref={contentRef} tabIndex={-1} className={`fin-month-records${mobile ? " fin-month-records-inline" : ""}`} aria-label={`${monthLabel} activity`} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); dismiss(); }
  }}>
    <button className="fin-month-records-close" aria-label="Close month activity" onClick={dismiss}><X size={16}/></button>
    <div ref={scrollRef} className="fin-month-records-scroll" tabIndex={0} role="region" aria-label={`${monthLabel} records`}>
      {selected.payments.length ? <ul>
        {selected.payments.map(payment => <li key={payment.id}>
          <div className="fin-month-record-facts"><strong><time dateTime={payment.date} title={financeDate(payment.date)}>{financeDate(payment.date)}</time></strong><strong>{payment.amountCents === null ? 'Amount unavailable' : financeMoney(payment.amountCents)}</strong></div>
          <Metadata items={[<strong>Payment recorded</strong>, payment.reconciled ? 'Reconciled' : payment.cleared ? 'Cleared' : 'Uncleared']}/>
          {payment.account && <dl className="fin-payment-account"><dt>Account</dt><dd>{payment.account}</dd></dl>}
          {payment.notes && <p className="fin-month-note" title={payment.notes}>{payment.notes}</p>}
          <button className="fin-month-journal" onClick={() => onNavigate(payment.target)}>View in Journal <ArrowRight size={14}/></button>
        </li>)}
      </ul> : <p>No recorded payments are available for this month.</p>}
    </div>
  </section>;
  return mobile ? content : <AnchoredFloatingPanel anchorRef={anchorRef} onClose={dismiss} width={380} height={360} disableMobileSheet scrollable={false} ariaLabel={`${monthLabel} activity`} style={{ background:'#16161e', isolation:'isolate' }}>
    <AnimatedHeight>{content}</AnimatedHeight>
  </AnchoredFloatingPanel>;
}
