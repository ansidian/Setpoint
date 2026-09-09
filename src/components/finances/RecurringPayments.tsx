import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Clock3 } from 'lucide-react';
import type { FinancePayment } from '../../hooks/calendar/financePaymentsModel';
import { financeDate, financeMoney } from './financeWorkspaceModel';

export default function RecurringPayments({ payments, selectedDate, loading, error, truncated, onPreview, onNavigate }: {
  payments: FinancePayment[]; selectedDate: string | null; loading: boolean; error: string; truncated: boolean;
  onPreview: (date: string | null) => void; onNavigate: (payment: FinancePayment) => void;
}) {
  return <section className="fin-payments" aria-label="Other recurring payments"><h2>Other recurring payments</h2>
    {(['scheduled', 'recorded'] as const).map(status => {
      const rows = payments.filter(row => !row.utilityId && row.status === status).sort((a, b) => status === 'scheduled'
        ? (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || ''));
      const StatusIcon = status === 'scheduled' ? Clock3 : Check;
      return <section className="fin-payment-group" key={status}><h3><StatusIcon size={13} aria-hidden="true"/>{status === 'scheduled' ? 'Scheduled' : 'Recorded'}<span>{rows.length}</span></h3>
        {status === 'recorded' && loading && <p role="status" className="fin-muted">Loading recorded payments…</p>}
        {status === 'recorded' && truncated && <p className="fin-muted">Recorded history is incomplete. Available records are shown.</p>}
        {status === 'recorded' && error && <p role="alert">Recorded payments unavailable. {error}</p>}
        {rows.map(row => {
          const Icon = row.direction === 'transfer' ? ArrowLeftRight : row.direction === 'income' ? ArrowDownLeft : ArrowUpRight;
          return <button className="fin-payment-row" data-finance-detail-trigger aria-haspopup="dialog" key={row.id} data-payment-date={row.date} data-selected={!!row.date && row.date === selectedDate}
            onMouseEnter={() => onPreview(row.date)} onMouseLeave={() => onPreview(null)} onFocus={() => onPreview(row.date)} onBlur={() => onPreview(null)} onClick={() => onNavigate(row)}>
            <Icon size={15} className={status === 'scheduled' ? 'fin-outflow' : 'fin-paid'} aria-hidden="true"/>
            <span><strong>{row.name}</strong><small>{row.date ? financeDate(row.date) : `Recording date unavailable · scheduled ${financeDate(row.scheduledDate || null)}`}{row.direction === 'transfer' ? ' · Transfer' : row.direction === 'income' ? ' · Inflow' : ''}</small></span>
            <strong className={status === 'scheduled' ? 'fin-outflow' : 'fin-paid'}>{row.amountCents === null ? 'Unavailable' : `${row.direction === 'income' ? '+' : row.direction === 'outflow' ? '−' : ''}${financeMoney(row.amountCents)}`}</strong>
          </button>;
        })}
        {!rows.length && !(status === 'recorded' && (loading || error)) && <p className="fin-payment-empty">No {status === 'scheduled' ? 'scheduled payments' : truncated ? 'loaded recorded payments' : 'recorded payments'} in this month.</p>}
      </section>;
    })}
  </section>;
}
