import { ArrowLeftRight, CheckCircle2, Clock3, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { paymentStatusLabels } from './paymentPresentationModel';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';
import MonthlyPaymentChart from './MonthlyPaymentChart';

export default function PaymentDetail({ row, historyComplete, onNavigate, onClose, actions, month }: {
  row: PaymentPresentationRow; historyComplete: boolean; actions?: ReactNode; month?: string;
  onNavigate: (target: FinanceDestination) => void; onClose: () => void;
}) {
  const recorded = row.status === 'paid' || row.status === 'received' || row.status === 'transferred';
  const Icon = row.direction === 'transfer' ? ArrowLeftRight : recorded ? CheckCircle2 : Clock3;
  const paymentDates = [...new Set(row.payments.map(payment => payment.date))];
  const amountLabel = row.amountKind === 'payment' ? 'Recorded amount' : row.amountKind === 'estimate' ? 'Schedule estimate' : 'Amount';
  return <article className="fin-payment-detail">
    <header className="fin-detail-heading"><div><h2>{row.name}</h2>{row.provider && row.provider !== row.name && <p>{row.provider}</p>}</div><button aria-label="Close payment details" onClick={onClose}><X size={16}/></button></header>
    {actions}
    <section className="fin-payment-summary" aria-label="Payment status">
      <div className={`fin-record-status ${recorded ? 'fin-paid' : row.status === 'scheduled' ? 'fin-due' : 'fin-muted'}`}><Icon size={16} aria-hidden="true"/><strong>{paymentStatusLabels[row.status]}</strong>{recorded && !paymentDates.length && !row.paymentDate && <span className="fin-muted">payment date unavailable</span>}</div>
      <dl className="fin-recurring-facts">
        <Fact label={amountLabel}>{row.amountCents === null ? 'Not provided' : financeMoney(row.amountCents)}</Fact>
        <Fact label="Due date">{row.dueDate ? financeDate(row.dueDate) : 'Not provided'}</Fact>
        {(!recorded || row.paymentDate || paymentDates.length > 0) && <Fact label={row.direction === 'income' ? 'Received date' : row.direction === 'transfer' ? 'Transfer date' : 'Payment date'}>{paymentDates.length > 1 ? paymentDates.map(date => <time className="fin-payment-date" key={date} dateTime={date}>{financeDate(date)}</time>) : row.paymentDate ? financeDate(row.paymentDate) : paymentDates[0] ? financeDate(paymentDates[0]) : recorded ? 'Unavailable' : 'No linked payment'}</Fact>}
        {row.nextOccurrence && <><Fact label="Next scheduled"><time dateTime={row.nextOccurrence.next_date}>{financeDate(row.nextOccurrence.next_date)}</time></Fact><Fact label="Schedule estimate">{financeMoney(Math.round(row.nextOccurrence.amount * 100))}</Fact></>}
      </dl>
      {row.status === 'scheduled' && <p className="fin-muted">Scheduled in Actual. No exact payment link is available for this occurrence.</p>}
      {row.status === 'unknown' && <p className="fin-muted">No recorded transaction confirms this month’s scheduled occurrence.</p>}
    </section>
    {(row.payments.length > 0 || row.history.length > 0) && <MonthlyPaymentChart payments={[...row.payments, ...row.history]} month={month || row.paymentDate?.slice(0, 7) || row.dueDate?.slice(0, 7) || new Date().toISOString().slice(0, 7)} historyComplete={historyComplete} onNavigate={onNavigate}/>}
    {row.unconfirmedOccurrences.length > 0 && <details className="fin-schedule-evidence"><summary>Unconfirmed schedule history <span>{row.unconfirmedOccurrences.length}</span></summary><p className="fin-muted">Actual’s schedule previously marked these occurrences paid. {historyComplete ? 'No matching transaction is present in the available payment history.' : 'Their matching transactions are not available in the loaded history.'} They are not counted as payments.</p><ul>{row.unconfirmedOccurrences.map(occurrence=><li key={occurrence.id}><span>Scheduled {financeDate(occurrence.next_date)}</span><span>{financeMoney(Math.round(Math.abs(occurrence.amount)*100))} estimate</span></li>)}</ul></details>}
    {!historyComplete && <p className="fin-notice">Payment history is incomplete. Additional payments may appear in Journal.</p>}
  </article>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
