import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { ArrowRight, ArrowUpRight, X } from 'lucide-react';
import AnchoredFloatingPanel from '../shared/pickers/AnchoredFloatingPanel';
import useMediaQuery from '../../hooks/useMediaQuery';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';

export default function CalendarPaymentPreview({ row, date, anchorRef, payLinks, onClose, onDetails, onNavigate }: {
  row: PaymentPresentationRow; date: string; anchorRef: RefObject<HTMLElement | null>; payLinks: string[];
  onClose: () => void; onDetails: () => void; onNavigate: (target: FinanceDestination) => void;
}) {
  const mobile = useMediaQuery('(max-width: 767px)');
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mobile) return;
    const frame=requestAnimationFrame(()=>contentRef.current?.focus({preventScroll:true}));
    return()=>cancelAnimationFrame(frame);
  },[mobile]);
  const close=()=>{onClose();anchorRef.current?.focus({preventScroll:true});};
  const status={paid:'Paid',received:'Received',transferred:'Transferred',scheduled:'Scheduled',unknown:'Status unknown',nothing_due:'Nothing due'}[row.status];
  return <AnchoredFloatingPanel anchorRef={anchorRef} onClose={close} width={380} height={440} forceMobileSheet={mobile} mobileHeight={null} ariaLabel={row.name} style={{background:'#16161e',isolation:'isolate'}}>
    <div ref={contentRef} tabIndex={-1} className="fin-month-records fin-calendar-preview" data-payment-date={date}>
      {!mobile&&<><h3>{row.name}</h3><button className="fin-month-records-close" aria-label="Close payment preview" onClick={close}><X size={16}/></button></>}
      <div className="fin-preview-summary"><strong>{status}</strong><div><strong>{financeMoney(row.amountCents)}</strong>{row.amountKind==='statement'&&<small>Statement amount</small>}</div></div>
      <dl className="fin-preview-dates">
        {row.dueDate&&<div><dt>Due</dt><dd>{financeDate(row.dueDate)}</dd></div>}
        {row.scheduledDate&&row.scheduledDate!==row.dueDate&&<div><dt>Scheduled</dt><dd>{financeDate(row.scheduledDate)}</dd></div>}
        {row.paymentDate&&<div><dt>{row.direction==='transfer'?'Transferred':row.direction==='income'?'Received':'Paid'}</dt><dd>{financeDate(row.paymentDate)}</dd></div>}
        {!row.paymentDate&&['paid','received','transferred'].includes(row.status)&&<div><dt>Payment date</dt><dd>Unavailable</dd></div>}
        {row.nextOccurrence&&<div><dt>Next scheduled</dt><dd>{financeDate(row.nextOccurrence.next_date)}</dd></div>}
      </dl>
      <div className="fin-preview-actions">
        {row.payments.map(payment=><button key={payment.id} className="fin-month-journal" onClick={()=>onNavigate(payment.target)}>View in Journal{row.payments.length>1?` · ${financeDate(payment.date)}`:''}<ArrowRight size={14}/></button>)}
        {payLinks.map(url=><button key={url} className="fin-month-journal" onClick={()=>window.open(url,'_blank','noopener,noreferrer')}>Pay online<ArrowUpRight size={14}/></button>)}
        <button className="fin-month-journal" onClick={onDetails}>Full details<ArrowRight size={14}/></button>
      </div>
    </div>
  </AnchoredFloatingPanel>;
}
