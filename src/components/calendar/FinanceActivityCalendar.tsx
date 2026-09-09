import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FinanceActivityDay } from '../../hooks/calendar/financeActivityModel';
import { financeMonthCells, financeMonthRange, shiftFinanceDate, shiftFinanceMonth } from '../../hooks/calendar/financeActivityModel';
import { financeDate, financeMoney } from '../finances/financeWorkspaceModel';
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
  onSelect: (date: string) => void;
  onMonth: (month: string) => void;
}

const compactMoney = (cents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
}).format(cents / 100);
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
});

export default function FinanceActivityCalendar({ month, today, days, selectedDate, previewDate, loading, unavailable, onSelect, onMonth }: Props) {
  const cells = financeMonthCells(month);
  const latest = financeMonthRange(month, today).end;
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
    const next = financeMonthRange(value, today).end;
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
    if (!target.startsWith(month) || target > today) return;
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
    if (date > today) return `${financeDate(date)}, future date`;
    if (!day || unavailable || loading) return `${financeDate(date)}, activity unavailable`;
    if (!day.complete) return `${financeDate(date)}, ${day.entries.length} visible records, totals unavailable`;
    return `${financeDate(date)}, ${financeMoney(day.incomeCents)} in, ${financeMoney(day.outflowCents)} out, ${day.transfers} transfers, ${day.entries.length} records`;
  };
  return <aside className="fin-activity-calendar" aria-label="Activity calendar" data-expanded={expanded} aria-busy={loading}>
    <div className="fac-heading"><h2>{monthLabel}</h2><div className="fac-month-navigation">
      <button aria-label="Previous activity month" onClick={() => navigateMonth(shiftFinanceMonth(month, -1))}><ChevronLeft size={16}/></button>
      <button aria-label="Next activity month" disabled={month >= today.slice(0, 7)} onClick={() => navigateMonth(shiftFinanceMonth(month, 1))}><ChevronRight size={16}/></button>
    </div><div className="fac-week-navigation">
      <button aria-label="Previous activity week" disabled={weekIndex === 0} onClick={() => changeWeek(-1)}><ChevronLeft size={16}/></button>
      <button aria-label="Next activity week" disabled={!cells[(weekIndex + 1) * 7]?.startsWith(month) || cells[(weekIndex + 1) * 7]! > today} onClick={() => changeWeek(1)}><ChevronRight size={16}/></button>
    </div></div>
    <div className="fac-legend"><span className="fin-income"><ArrowDownLeft size={12}/>In</span><span className="fin-outflow"><ArrowUpRight size={12}/>Out</span><span className="fin-transfer"><ArrowLeftRight size={12}/>Transfer</span></div>
    <AnimatedHeight><div className="fac-grid" aria-label={monthLabel}>
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <span className="fac-weekday" aria-hidden="true" key={index}>{label}</span>)}
      {cells.map((date, index) => {
        const day = byDate.get(date);
        const inMonth = date.startsWith(month), future = date > today;
        const known = !!day && !loading && !unavailable;
        const hasFlow = known && (day.incomeCents > 0 || day.outflowCents > 0 || day.transfers > 0);
        return <button key={date} ref={element => { if (element) buttons.current.set(date, element); else buttons.current.delete(date); }}
          className="fac-day" data-week={Math.floor(index / 7) === weekIndex} data-outside={!inMonth} data-preview={date === previewDate}
          data-today={date === today} data-has-activity={hasFlow} aria-pressed={date === selectedDate}
          aria-current={date === today ? 'date' : undefined} aria-label={description(date, day)}
          disabled={!inMonth || future || !known} tabIndex={date === visibleFocusDate ? 0 : -1}
          onFocus={() => setFocusDate(date)} onKeyDown={event => keyboard(event, date)} onClick={() => select(date)}>
          <span className="fac-day-number">{Number(date.slice(-2))}</span>
          {known && day.complete && inMonth ? <span className="fac-amounts" aria-hidden="true">
            {day.incomeCents > 0 && <span className="fin-income"><span className="fac-exact">+{financeMoney(day.incomeCents)}</span><span className="fac-compact">+{compactMoney(day.incomeCents)}</span></span>}
            {day.outflowCents > 0 && <span className="fin-outflow"><span className="fac-exact">−{financeMoney(day.outflowCents)}</span><span className="fac-compact">−{compactMoney(day.outflowCents)}</span></span>}
            {day.transfers > 0 && <span className="fin-transfer fac-transfer-mark"><ArrowLeftRight size={11}/><span>{day.transfers}</span></span>}
          </span> : known && inMonth && !day.complete ? <span className="fac-incomplete" aria-hidden="true">?</span> : null}
          {known && inMonth && day.complete && <span className="fac-markers" aria-hidden="true"><i data-flow="in" data-visible={day.incomeCents > 0}/><i data-flow="out" data-visible={day.outflowCents > 0}/>{day.transfers > 0 && <ArrowLeftRight size={10}/>}</span>}
        </button>;
      })}
    </div></AnimatedHeight>
    <div className="fac-controls"><button className="fac-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show week' : 'Show month'}<ChevronDown size={13}/></button><button className="fac-current" onClick={() => { if (month !== today.slice(0, 7)) navigateMonth(today.slice(0, 7)); else select(today); }}>Today</button></div>
    <div className="fac-day-summary" aria-live="polite" aria-atomic="true"><div><strong>{dayLabel(activeDate)}</strong><span>{loading ? 'Loading…' : unavailable || !activeDay ? 'Activity unavailable' : `${activeDay.entries.length} ${activeDay.complete ? '' : 'visible '}record${activeDay.entries.length === 1 ? '' : 's'}${activeDay.complete && activeDay.transfers ? ` · ${activeDay.transfers} transfer${activeDay.transfers === 1 ? '' : 's'}` : ''}`}</span></div>
      {activeDay && !loading && !unavailable && (activeDay.complete ? <dl><div><dt>In</dt><dd className="fin-income">+{financeMoney(activeDay.incomeCents)}</dd></div><div><dt>Out</dt><dd className="fin-outflow">−{financeMoney(activeDay.outflowCents)}</dd></div></dl> : <p>Totals unavailable for this day. Review its recorded rows for details.</p>)}
    </div>
    <p className="fac-hint">Select a day to find its rows.</p>
  </aside>;
}
