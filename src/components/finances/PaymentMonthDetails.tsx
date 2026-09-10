import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { ArrowRight, X } from 'lucide-react';
import AnchoredFloatingPanel from '../shared/pickers/AnchoredFloatingPanel';
import type { MonthlyPaymentAmount } from './monthlyPaymentModel';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';

export default function PaymentMonthDetails({ selected, mobile, anchorRef, onClose, onNavigate }: {
  selected: MonthlyPaymentAmount; mobile: boolean; anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void; onNavigate: (target: FinanceDestination) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mobile) return;
    const frame = requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [mobile]);
  const dismiss = () => {
    if (contentRef.current?.contains(document.activeElement) || document.activeElement === anchorRef.current) anchorRef.current?.focus({ preventScroll: true });
    onClose();
  };
  const content = <div id="selected-month-payments" ref={contentRef} tabIndex={-1} className={`fin-month-records${mobile ? ' fin-month-records-inline' : ''}`}>
    {!mobile && <button className="fin-month-records-close" aria-label="Close monthly payment details" onClick={dismiss}><X size={16}/></button>}
    {selected.payments.length ? <ul>{selected.payments.map(payment => <li key={payment.id}>
      <div className="fin-month-record-facts"><strong>{financeDate(payment.date)}</strong><strong>{payment.amountCents === null ? 'Amount unavailable' : financeMoney(payment.amountCents)}</strong></div>
      <p>{payment.account && `${payment.account} · `}{payment.reconciled ? 'Reconciled' : payment.cleared ? 'Cleared' : 'Uncleared'}</p>
      {payment.notes && <p>{payment.notes}</p>}
      <button className="fin-month-journal" onClick={() => onNavigate(payment.target)}>View in Journal <ArrowRight size={14}/></button>
    </li>)}</ul> : <p>No recorded payments loaded for this month.</p>}
  </div>;
  return mobile ? content : <AnchoredFloatingPanel anchorRef={anchorRef} onClose={dismiss} width={360} height={360} disableMobileSheet ariaLabel={`Payments recorded in ${selected.month}`} style={{ background: '#16161e', isolation: 'isolate' }}>{content}</AnchoredFloatingPanel>;
}
