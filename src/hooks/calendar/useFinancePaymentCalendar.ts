import { useEffect, useMemo, useState } from 'react';
import { getFinanceJournal } from '../../api';
import type { FinanceWorkspace, JournalRange } from '../../../shared/types/finances';
import { financePayments } from './financePaymentsModel';
import { financeMonthRange } from './financeActivityModel';

export default function useFinancePaymentCalendar(data: FinanceWorkspace | null, revision: number, active: boolean, initialMonth?: string) {
  const [chosenMonth, setMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const [range, setRange] = useState<JournalRange | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const month = initialMonth || chosenMonth || data?.end.slice(0, 7) || '';
  const today = data?.end || '';
  const { start, end } = month && today ? financeMonthRange(month, today) : { start: '', end: '' };
  useEffect(() => {
    if (!active || !start || start > end) return;
    let live = true;
    const load = async () => {
      setLoading(true); setError('');
      try { const result = await getFinanceJournal(start, end); if (live) setRange(result); }
      catch (cause) { if (live) setError(cause instanceof Error ? cause.message : 'Recorded payments unavailable'); }
      finally { if (live) setLoading(false); }
    };
    void load();
    return () => { live = false; };
  }, [start, end, revision, active]);
  const visibleRange = range?.start === start && range.end === end ? range : null;
  const model = useMemo(() => data ? financePayments(data, visibleRange, month) : null, [data, visibleRange, month]);
  const changeMonth = (value: string) => { setMonth(value); setSelectedDate(null); setPreviewDate(null); };
  const lookahead = today ? new Date(`${today}T00:00:00Z`) : null;
  if (lookahead) lookahead.setUTCMonth(lookahead.getUTCMonth() + 3);
  return { ...model, month, selectedDate, previewDate, setSelectedDate, setPreviewDate, changeMonth,
    loading: start <= end && (loading || !visibleRange && !error), error: start <= end ? error : '',
    truncated: !!visibleRange?.truncated,
    // The workspace's saved schedule projection looks ahead three months; do not imply unlimited forecast coverage.
    through: lookahead?.toISOString().slice(0, 10) || '' };
}
