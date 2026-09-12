import { ArrowLeftRight, CheckCircle2, Clock3, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';
import MonthlyPaymentChart from './MonthlyPaymentChart';

const statusLabels = { paid: 'Paid', received: 'Received', transferred: 'Transferred', scheduled: 'Scheduled', statement: 'Statement received', nothing_due: 'Nothing due', unknown: 'Status unknown' } as const;

export default function PaymentDetail({ row, historyComplete, onNavigate, onForeground, onClose, actions, month }: {
  row: PaymentPresentationRow; historyComplete: boolean; actions?: ReactNode; month?: string;
  onNavigate: (target: FinanceDestination) => void; onForeground: (href: string) => void; onClose: () => void;
}) {
  const recorded = row.status === 'paid' || row.status === 'received' || row.status === 'transferred';
  const Icon = row.direction === 'transfer' ? ArrowLeftRight : recorded ? CheckCircle2 : Clock3;
  const paymentDates = [...new Set(row.payments.map(payment => payment.date))];
  const statements = [...row.statements, ...row.statementHistory.filter(statement => !row.statements.some(selected => selected.id === statement.id))];
  const amountLabel = row.amountKind === 'payment' ? 'Recorded amount' : row.amountKind === 'statement' ? row.isCreditCard ? 'Statement balance' : 'Statement amount' : row.amountKind === 'estimate' ? 'Schedule estimate' : 'Amount';
  return <article className="fin-payment-detail">
    <header className="fin-detail-heading"><div><h2>{row.name}</h2>{row.provider && row.provider !== row.name && <p>{row.provider}</p>}</div><button aria-label="Close payment details" onClick={onClose}><X size={16}/></button></header>
    {actions}
    <section className="fin-payment-summary" aria-label="Payment status">
      <div className={`fin-record-status ${recorded ? 'fin-paid' : row.status === 'scheduled' ? 'fin-due' : 'fin-muted'}`}><Icon size={16} aria-hidden="true"/><strong>{statusLabels[row.status]}</strong>{recorded && !paymentDates.length && !row.paymentDate && <span className="fin-muted">payment date unavailable</span>}</div>
      <dl className="fin-recurring-facts">
        <Fact label={amountLabel}>{row.amountCents === null ? 'Not provided' : financeMoney(row.amountCents)}</Fact>
        <Fact label={row.dueDate ? "Due date" : row.scheduledDate ? "Scheduled date" : "Due date"}>{row.dueDate ? financeDate(row.dueDate) : row.scheduledDate ? financeDate(row.scheduledDate) : row.status === 'nothing_due' ? 'No payment required' : 'Not provided'}</Fact>
        {row.scheduledDate && row.dueDate && (row.scheduledDate !== row.dueDate || row.isCreditCard) && <Fact label={row.isCreditCard ? "Transfer scheduled" : "Scheduled date"}>{financeDate(row.scheduledDate)}</Fact>}
        {row.isCreditCard && row.occurrence && <Fact label="Transfer estimate">{financeMoney(Math.round(Math.abs(row.occurrence.amount) * 100))}</Fact>}
        {row.isCreditCard && row.statements.length > 0 && row.payments.length > 0 && <Fact label="Recorded transfers this month">{row.payments.map(payment => <span className="fin-payment-date" key={payment.id}>{financeMoney(payment.amountCents)} · {financeDate(payment.date)}</span>)}</Fact>}
        {!(row.isCreditCard && row.statements.length > 0) && (!recorded || row.paymentDate || paymentDates.length > 0) && <Fact label={row.direction === 'income' ? 'Received date' : row.direction === 'transfer' ? 'Transfer date' : 'Payment date'}>{paymentDates.length > 1 ? paymentDates.map(date => <time className="fin-payment-date" key={date} dateTime={date}>{financeDate(date)}</time>) : row.paymentDate ? financeDate(row.paymentDate) : paymentDates[0] ? financeDate(paymentDates[0]) : recorded ? 'Unavailable' : 'No linked payment'}</Fact>}
        {row.nextOccurrence && <><Fact label="Next scheduled"><time dateTime={row.nextOccurrence.next_date}>{financeDate(row.nextOccurrence.next_date)}</time></Fact><Fact label="Schedule estimate">{financeMoney(Math.round(row.nextOccurrence.amount * 100))}</Fact></>}
      </dl>
      {row.status === 'scheduled' && <p className="fin-muted">{row.occurrence ? 'Scheduled in Actual. No exact payment link is available for this occurrence.' : 'Statement due. No linked payment is available.'}</p>}
      {row.isCreditCard && row.statements.length > 0 && <p className="fin-muted">Statement balance and due date come from the original statement. Recorded transfers are shown separately; they do not confirm that this statement is paid in full.</p>}
      {row.status === 'unknown' && <p className="fin-muted">No statement or scheduled occurrence establishes a payment status for this month.</p>}
    </section>
    {(row.payments.length > 0 || row.history.length > 0 || statements.length > 0) && <MonthlyPaymentChart payments={[...row.payments, ...row.history]} statements={statements} month={month || row.paymentDate?.slice(0, 7) || row.scheduledDate?.slice(0, 7) || new Date().toISOString().slice(0, 7)} historyComplete={historyComplete} onNavigate={onNavigate} onForeground={onForeground}/>}
    {!!row.unconfirmedOccurrences?.length && <details className="fin-schedule-evidence"><summary>Unconfirmed schedule history <span>{row.unconfirmedOccurrences.length}</span></summary><p className="fin-muted">Actual’s schedule previously marked these occurrences paid. {historyComplete ? 'No matching transaction is present in the available payment history.' : 'Their matching transactions are not available in the loaded history.'} They are not counted as payments.</p><ul>{row.unconfirmedOccurrences.map(occurrence=><li key={occurrence.id}><span>Scheduled {financeDate(occurrence.next_date)}</span><span>{financeMoney(Math.round(Math.abs(occurrence.amount)*100))} estimate</span></li>)}</ul></details>}
    {!historyComplete && <p className="fin-notice">Payment history is incomplete. Additional payments may appear in Journal.</p>}
  </article>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
