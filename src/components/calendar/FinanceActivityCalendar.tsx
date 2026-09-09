import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Check, Clock3 } from 'lucide-react';
import type { FinancePayment, ScheduledPaymentDay } from '../../hooks/calendar/financePaymentsModel';
import type { FinanceActivityDay } from '../../hooks/calendar/financeActivityModel';
import { financeMonthCells, financeMonthRange, shiftFinanceDate, shiftFinanceMonth } from '../../hooks/calendar/financeActivityModel';
import { financeDate, financeMoney } from '../finances/financeWorkspaceModel';
import FinancePaymentDayList from './FinancePaymentDayList';
import AnimatedHeight from '../shared/AnimatedHeight';
import './finance-activity-calendar.css';

interface Props {
  month: string;
  today: string;
  days: FinanceActivityDay[];
  selectedDate: string | null;
  previewDate: string | null;
  loading: boolean;
  unavailable: boolean;
  scheduledDays?: ScheduledPaymentDay[];
  payments?: FinancePayment[];
  onPayment?: (payment: FinancePayment) => void;
  through?: string;
  earliest?: string;
  onSelect: (date: string) => void;
  onClearSelection: () => void;
  onMonth: (month: string) => void;
}

const compactMoney = (cents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
}).format(cents / 100);
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
});

export default function FinanceActivityCalendar({ month, today, days, selectedDate, previewDate, loading, unavailable, scheduledDays, payments, onPayment, through = today, earliest, onSelect, onClearSelection, onMonth }: Props) {
  useEffect(() => {
    if (!selectedDate) return;
    const clearOutsideDay = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-payment-date]') : null;
      if (target?.getAttribute('data-payment-date') !== selectedDate) onClearSelection();
    };
    // Capture clears the previous selection before a different date's click selects it.
    document.addEventListener('click', clearOutsideDay, true);
    return () => document.removeEventListener('click', clearOutsideDay, true);
  }, [selectedDate, onClearSelection]);
  const cells = financeMonthCells(month);
  const latest = today.startsWith(month) ? today : financeMonthRange(month, through).end;
  const scheduledByDate = new Map(scheduledDays?.map(day => [day.date, day]));
  const paymentMode = scheduledDays !== undefined;
  const [expanded, setExpanded] = useState(false);
  const [weekDate, setWeekDate] = useState(selectedDate || latest);
  const [focusDate, setFocusDate] = useState(selectedDate || latest);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const byDate = new Map(days.map(day => [day.date, day]));
  const activeDate = previewDate || selectedDate || latest;
  const activeDay = byDate.get(activeDate);
  const visibleWeekDate = weekDate.startsWith(month) ? weekDate : latest;
  const visibleFocusDate = focusDate.startsWith(month) ? focusDate : latest;
  const weekIndex = Math.max(0, Math.floor(cells.indexOf(visibleWeekDate) / 7));
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const select = (date: string) => { setFocusDate(date); setWeekDate(date); onSelect(date); };
  const navigateMonth = (value: string) => {
    const next = financeMonthRange(value, through).end;
    setWeekDate(next);
    setFocusDate(next);
    onMonth(value);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const target = shiftFinanceDate(date, offsets[event.key]!);
    if (!target.startsWith(month) || target > through || !!earliest && target < earliest) return;
    setFocusDate(target);
    setWeekDate(target);
    // The new week is made visible by React before moving keyboard focus.
    requestAnimationFrame(() => buttons.current.get(target)?.focus());
  };
  const changeWeek = (offset: number) => {
    const candidate = cells[(weekIndex + offset) * 7];
    if (!candidate) return;
    const next = candidate < `${month}-01` ? `${month}-01` : candidate;
    setWeekDate(next);
    setFocusDate(next);
  };
  const description = (date: string, day?: FinanceActivityDay) => {
    if (date > through) return `${financeDate(date)}, future date`;
    const scheduled = paymentMode ? `, ${scheduledByDate.get(date)?.count || 0} scheduled payments` : '';
    if (!day || unavailable || loading) return `${financeDate(date)}, recorded activity unavailable${scheduled}`;
    if (!day.complete) return `${financeDate(date)}, ${day.entries.length} visible records, totals unavailable${scheduled}`;
    return `${financeDate(date)}, ${financeMoney(day.incomeCents)} in, ${financeMoney(day.outflowCents)} out, ${day.transfers} transfers, ${day.entries.length} records${scheduled}`;
  };
  return <aside className="fin-activity-calendar" data-payments={paymentMode} aria-label={paymentMode ? "Payment calendar" : "Activity calendar"} data-expanded={expanded} aria-busy={loading}>
    <div className="fac-heading"><h2>{monthLabel}</h2><div className="fac-month-navigation">
      <button aria-label="Previous activity month" disabled={!!earliest && month <= earliest.slice(0, 7)} onClick={() => navigateMonth(shiftFinanceMonth(month, -1))}><ChevronLeft size={16}/></button>
      <button aria-label="Next activity month" disabled={month >= through.slice(0, 7)} onClick={() => navigateMonth(shiftFinanceMonth(month, 1))}><ChevronRight size={16}/></button>
    </div><div className="fac-week-navigation">
      <button aria-label="Previous activity week" disabled={weekIndex === 0} onClick={() => changeWeek(-1)}><ChevronLeft size={16}/></button>
      <button aria-label="Next activity week" disabled={!cells[(weekIndex + 1) * 7]?.startsWith(month) || cells[(weekIndex + 1) * 7]! > through} onClick={() => changeWeek(1)}><ChevronRight size={16}/></button>
    </div></div>
    <div className="fac-legend">{paymentMode ? <><span className="fin-paid"><Check size={12} aria-hidden="true"/>Recorded</span><span className="fin-outflow"><Clock3 size={12}/>Scheduled</span><span className="fin-transfer"><ArrowLeftRight size={12}/>Transfer</span></> : <><span className="fin-income"><ArrowDownLeft size={12}/>In</span><span className="fin-outflow"><ArrowUpRight size={12}/>Out</span><span className="fin-transfer"><ArrowLeftRight size={12}/>Transfer</span></>}</div>
    <AnimatedHeight><div className="fac-grid" aria-label={monthLabel}>
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <span className="fac-weekday" aria-hidden="true" key={index}>{label}</span>)}
      {cells.map((date, index) => {
        const day = byDate.get(date);
        const scheduled = scheduledByDate.get(date);
        const inMonth = date.startsWith(month), future = date > through;
        const known = !!day && !loading && !unavailable;
        const hasFlow = !!scheduled || known && (day.incomeCents > 0 || day.outflowCents > 0 || day.transfers > 0);
        return <button key={date} ref={element => { if (element) buttons.current.set(date, element); else buttons.current.delete(date); }}
          className="fac-day" data-payment-date={date} data-week={Math.floor(index / 7) === weekIndex} data-outside={!inMonth} data-preview={date === previewDate}
          data-today={date === today} data-has-activity={hasFlow} aria-pressed={date === selectedDate}
          aria-current={date === today ? 'date' : undefined} aria-label={description(date, day)}
          disabled={!inMonth || future || !!earliest && date < earliest || !paymentMode && !known} tabIndex={date === visibleFocusDate ? 0 : -1}
          onFocus={() => setFocusDate(date)} onKeyDown={event => keyboard(event, date)} onClick={() => select(date)}>
          <span className="fac-day-number">{Number(date.slice(-2))}</span>
          {inMonth && scheduled && <span className="fac-scheduled fin-outflow" aria-hidden="true"><Clock3 size={10}/><span>{scheduled.count}</span></span>}
          {known && day.complete && inMonth ? <span className="fac-amounts" aria-hidden="true">
            {day.incomeCents > 0 && <span className="fin-income"><span className="fac-exact">+{financeMoney(day.incomeCents)}</span><span className="fac-compact">+{compactMoney(day.incomeCents)}</span></span>}
            {day.outflowCents > 0 && <span className={paymentMode ? "fin-paid" : "fin-outflow"}><span className="fac-exact">−{financeMoney(day.outflowCents)}</span><span className="fac-compact">−{compactMoney(day.outflowCents)}</span></span>}
            {day.transfers > 0 && <span className="fin-transfer fac-transfer-mark"><ArrowLeftRight size={11}/><span>{day.transfers}</span></span>}
          </span> : known && inMonth && !day.complete ? <span className="fac-incomplete" aria-hidden="true">?</span> : null}
          {known && inMonth && day.complete && <span className="fac-markers" aria-hidden="true"><i data-flow="in" data-visible={day.incomeCents > 0}/><i data-flow="out" data-visible={day.outflowCents > 0}/>{day.transfers > 0 && <ArrowLeftRight size={10}/>}</span>}
        </button>;
      })}
    </div></AnimatedHeight>
    <div className="fac-controls"><button className="fac-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show week' : 'Show month'}<ChevronDown size={13}/></button><button className="fac-current" onClick={() => { if (month !== today.slice(0, 7)) navigateMonth(today.slice(0, 7)); else select(today); }}>Today</button></div>
    <div className="fac-day-summary" data-payment-date={activeDate} aria-live="polite" aria-atomic="true"><div><strong>{dayLabel(activeDate)}</strong><span>{paymentMode ? 'Paid & due' : loading ? 'Loading…' : unavailable || !activeDay ? 'Recorded activity unavailable' : `${activeDay.entries.length} ${activeDay.complete ? '' : 'visible '}record${activeDay.entries.length === 1 ? '' : 's'}${activeDay.complete && activeDay.transfers ? ` · ${activeDay.transfers} transfer${activeDay.transfers === 1 ? '' : 's'}` : ''}`}</span></div>
      {!paymentMode && activeDay && !loading && !unavailable && (activeDay.complete ? <dl><div><dt>In</dt><dd className="fin-income">+{financeMoney(activeDay.incomeCents)}</dd></div><div><dt>Out</dt><dd className="fin-outflow">−{financeMoney(activeDay.outflowCents)}</dd></div></dl> : <p>Totals unavailable for this day. Review its recorded rows for details.</p>)}
      {payments && onPayment && <FinancePaymentDayList date={activeDate} payments={payments} loading={loading} unavailable={unavailable} complete={!!activeDay?.complete} onNavigate={onPayment}/>}
    </div>
    <p className="fac-hint">{paymentMode ? 'Utilities and recurring payments · available schedules only.' : 'Select a day to find its rows.'}</p>
  </aside>;
}
