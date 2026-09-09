import { ArrowRight, ArrowLeftRight, CalendarDays, CheckCircle2, Clock3, Repeat2, UserRound, X } from 'lucide-react';
import type { ActualBillOccurrence } from '../../../shared/types/actual';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';

export default function RecurringPaymentDetail({schedule,onNavigate,onClose}:{
  schedule:ActualBillOccurrence;onNavigate:(target:FinanceDestination)=>void;onClose:()=>void;
}) {
  const paymentId=schedule.paymentTransactionIds?.[0];
  const Icon=schedule.type==='transfer'?ArrowLeftRight:Repeat2;
  const StatusIcon=schedule.paid?CheckCircle2:Clock3;
  return <article className="fin-recurring-detail" style={{'--fin-amount-color':schedule.paid?'var(--sp-income)':'var(--sp-outflow)'} as React.CSSProperties}>
    <header className="fin-detail-heading"><div className="fin-detail-identity"><span className={`fin-detail-icon ${schedule.type==='income'?'fin-income':schedule.type==='transfer'?'fin-transfer':'fin-outflow'}`}><Icon size={20} aria-hidden="true"/></span><div><h2>{schedule.name}</h2><p>Recurring {schedule.type==='income'?'income':schedule.type==='transfer'?'transfer':'payment'}</p></div></div><button aria-label="Close recurring payment details" onClick={onClose}><X size={16}/></button></header>
    <section className="fin-bill-hero" aria-label="Scheduled occurrence">
      <div className="fin-between"><span>Scheduled amount</span><span className={`fin-record-status ${schedule.paid?'fin-paid':'fin-due'}`}><StatusIcon size={13} aria-hidden="true"/>{schedule.paid?'Recorded':'Scheduled'}</span></div>
      <div className="fin-bill-amount">{financeMoney(Math.round(schedule.amount*100))}</div>
      <p className="fin-fact-line"><CalendarDays size={14} aria-hidden="true"/>{financeDate(schedule.next_date)}</p>
    </section>
    <dl className="fin-recurring-facts"><div><dt><UserRound size={13} aria-hidden="true"/>Payee</dt><dd>{schedule.payee || 'Not specified'}</dd></div><div><dt><Icon size={13} aria-hidden="true"/>Type</dt><dd>{schedule.type==='income'?'Income':schedule.type==='transfer'?'Account transfer':'Bill payment'}</dd></div></dl>
    <section className="fin-recurring-record"><h3><StatusIcon size={14} aria-hidden="true"/>{schedule.paid?'Recorded in Actual':'Awaiting a recorded transaction'}</h3><p>{schedule.paid ? paymentId ? 'Open the linked transaction to review its recorded details.' : 'The occurrence is recorded. Its exact transaction link is unavailable.' : 'This amount comes from the Actual schedule. Recorded transactions appear in Journal.'}</p>
      <button className="fin-link" onClick={()=>onNavigate({view:'journal',date:schedule.next_date,...(paymentId?{transactionId:paymentId}:{})})}>{paymentId?'View transaction in Journal':'View this day in Journal'}<ArrowRight size={14}/></button>
    </section>
  </article>;
}
