import { useEffect, useId, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { PaymentStatement } from '../../../shared/types/finances';
import type { RecordedPayment } from './paymentPresentationModel';
import { financeMoney } from './financeWorkspaceModel';
import { monthlyPaymentAmounts } from './monthlyPaymentModel';
import type { FinanceDestination } from './financesNavigation';
import useMediaQuery from '../../hooks/useMediaQuery';
import PaymentMonthDetails from './PaymentMonthDetails';

const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
export default function MonthlyPaymentChart({ payments, statements, month, historyComplete, onNavigate, onForeground }: {
  payments: RecordedPayment[]; statements: PaymentStatement[]; month: string; historyComplete: boolean; onNavigate: (target: FinanceDestination) => void; onForeground: (href: string) => void;
}) {
  const contentId = useId();
  const mobile = useMediaQuery('(max-width: 767px)');
  const anchorRef = useRef<HTMLButtonElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (chartRef.current) chartRef.current.scrollLeft = chartRef.current.scrollWidth;
  }, [month]);
  const amounts = monthlyPaymentAmounts(payments, statements, month);
  const current = amounts.find(value => value.month === (hovered || focused || selectedMonth));
  const selected = amounts.find(value => value.month === selectedMonth);
  const max = Math.max(1, ...amounts.map(value => value.amountCents ?? 0));
  const describe = (value: (typeof amounts)[number]) => `${monthLabel(value.month)}: ${value.amountCents === null ? 'No complete payment amount available' : `${financeMoney(value.amountCents)}${!historyComplete ? ' recorded so far' : ''}`}${value.statements.length ? '; original bill available' : ''}`;
  return <section className="fin-history fin-monthly-chart">
    <div className="fin-monthly-heading"><h3>Monthly payments</h3><span className="fin-muted">12 months</span></div>
    <div className="fin-history-content">
      <p className="fin-monthly-amount" aria-live="polite" style={{ minHeight: '1.5em' }}>{current ? current.amountCents === null ? '—' : financeMoney(current.amountCents) : ''}</p>
      <div ref={chartRef} className="fin-chart" role="group" aria-label="Amounts paid by recording month">
        {amounts.map(value => <button key={value.month} aria-pressed={selectedMonth === value.month} data-preview={current?.month === value.month} aria-controls={selectedMonth === value.month ? contentId : undefined} aria-expanded={selectedMonth === value.month} aria-haspopup={mobile ? undefined : "dialog"} onClick={event => { anchorRef.current = event.currentTarget; setSelectedMonth(previous => previous === value.month ? null : value.month); }} aria-label={describe(value)} onFocus={event => setFocused(event.currentTarget.matches(':focus-visible') ? value.month : null)} onBlur={() => setFocused(null)} onMouseEnter={() => setHovered(value.month)} onMouseLeave={() => setHovered(null)}>
          <span className="fin-bar-space">{value.amountCents !== null ? <i style={{ height: `${Math.max(2, value.amountCents / max * 100)}%` }}/> : <span aria-hidden="true">{value.statements.length ? <FileText size={15}/> : '—'}</span>}</span>
          <span className="fin-month-label">{monthLabel(value.month).split(' ')[0]}</span>
        </button>)}
      </div>
      {selected && <PaymentMonthDetails key={`${selected.month}:${mobile}`} selected={selected} mobile={mobile} contentId={contentId} anchorRef={anchorRef} onClose={() => setSelectedMonth(null)} onNavigate={onNavigate} onForeground={onForeground}/>}
    </div>
  </section>;
}
