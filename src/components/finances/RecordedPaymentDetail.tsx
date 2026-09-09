import { ArrowRight, Check, X } from 'lucide-react';
import type { FinancePayment } from '../../hooks/calendar/financePaymentsModel';
import type { FinanceActivityDay } from '../../hooks/calendar/financeActivityModel';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';

export default function RecordedPaymentDetail({ payment, entry, onClose, onNavigate }: {
  payment: FinancePayment; entry?: FinanceActivityDay['entries'][number];
  onClose: () => void; onNavigate: (target: FinanceDestination) => void;
}) {
  const row = entry?.transaction;
  return <article style={{ '--fin-amount-color': 'var(--sp-income)' } as React.CSSProperties}>
    <header className="fin-detail-heading"><div><h2>{payment.name}</h2><p>Recorded payment</p></div><button aria-label="Close recorded payment details" onClick={onClose}><X size={16}/></button></header>
    <section className="fin-bill-hero"><div className="fin-between"><span>{financeDate(payment.date)}</span><span className="fin-record-status fin-paid"><Check size={13} aria-hidden="true"/>Recorded in Actual</span></div><div className="fin-bill-amount">{financeMoney(payment.amountCents)}</div></section>
    <dl className="fin-recurring-facts"><div><dt>Account</dt><dd>{row?.account || 'Unavailable'}</dd></div><div><dt>Category</dt><dd>{payment.direction === 'transfer' ? 'Account transfer' : entry?.kind === 'split' ? 'Split transaction' : row?.category || 'Uncategorized'}</dd></div><div><dt>Payee</dt><dd>{row?.payee || payment.name}</dd></div><div><dt>Status</dt><dd>{row?.reconciled ? 'Reconciled' : row?.cleared ? 'Cleared' : 'Uncleared'}</dd></div></dl>
    {row?.notes && <section className="fin-journal-notes"><h3>Notes</h3><p>{row.notes}</p></section>}
    {!!entry?.children.length && <section className="fin-journal-splits"><h3>Split categories</h3>{entry.children.map(child => <div className="fin-split" key={child.id}><span>{child.category || 'Uncategorized'}</span><span>{financeMoney(Math.abs(child.amountCents))}</span></div>)}</section>}
    {payment.amountCents === null && <p className="fin-notice">The full recorded amount is unavailable.</p>}
    <button className="fin-link" onClick={() => onNavigate(payment.target)}>View in Journal<ArrowRight size={14}/></button>
  </article>;
}
