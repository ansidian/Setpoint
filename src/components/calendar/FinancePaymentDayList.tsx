import Metadata from "../shared/Metadata";
import { ArrowLeftRight, ChevronRight, Check, Clock3 } from 'lucide-react';
import type { FinancePayment } from '../../hooks/calendar/financePaymentsModel';
import { financeMoney } from '../finances/financeWorkspaceModel';

export default function FinancePaymentDayList({ date, payments, loading, unavailable, complete, onNavigate }: {
  date: string; payments: FinancePayment[]; loading: boolean; unavailable: boolean; complete: boolean;
  onNavigate: (payment: FinancePayment, trigger: HTMLButtonElement) => void;
}) {
  const rows = payments.filter(payment => payment.date === date);
  return <div className="fac-payment-list" aria-label="Payments on this day">
    {rows.map(row => {
      const StatusIcon = row.status === 'recorded' ? Check : Clock3;
      return <button key={`${row.status}:${row.id}`} data-finance-detail-trigger onClick={event => onNavigate(row, event.currentTarget)}>
        <StatusIcon size={14} className={row.status === 'recorded' ? 'fin-paid' : 'fin-outflow'} aria-hidden="true"/>
        <span><strong>{row.name}</strong><Metadata items={[row.status === 'recorded' ? row.direction === 'transfer' ? 'Transferred' : row.direction === 'income' ? 'Received' : 'Paid' : row.status === 'statement' ? 'Statement due' : 'Scheduled · Estimate', row.status === 'statement' ? null : row.direction === 'transfer' ? 'Transfer' : row.direction === 'income' ? 'Inflow' : null]}/></span>
        <strong className={row.status === 'recorded' ? 'fin-paid' : 'fin-outflow'}>{financeMoney(row.amountCents)}</strong>
        {row.direction === 'transfer' ? <ArrowLeftRight size={13} className="fin-transfer" aria-hidden="true"/> : <ChevronRight size={13} aria-hidden="true"/>}
      </button>;
    })}
    {loading ? <p role="status">Loading recorded payments…</p> : unavailable ? <p role="status">Recorded payments unavailable. Available schedules are shown.</p> : !complete ? <p>Recorded history is incomplete. Available payments are shown.</p> : !rows.length ? <p>No available payments on this day.</p> : null}
  </div>;
}
