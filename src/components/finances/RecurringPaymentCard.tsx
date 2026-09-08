import type { ReactNode } from 'react';
import { CalendarDays, Check, CircleCheck, CircleDashed } from 'lucide-react';
import { daysUntil } from '../../lib/bill-utils';
import { daysLabel, urgencyForDays } from '../../lib/shell-helpers';
import { RailDueBadge, RailFactRow, RailHeroCard } from '../calendar/DetailRailPrimitives';
import { financeDate, financeMoney } from './financeWorkspaceModel';

export default function RecurringPaymentCard({ bill, actions }: { bill: Record<string, unknown>; actions?: ReactNode }) {
  const date = typeof bill.next_date === 'string' ? bill.next_date : null;
  const days = daysUntil(date);
  const paid = !!bill.paid;
  const amount = typeof bill.amount === 'number' && Number.isFinite(bill.amount) ? Math.round(Math.abs(bill.amount) * 100) : null;
  const dueColor = paid ? 'var(--sp-green)' : days === null ? 'var(--sp-subtext)' : urgencyForDays(days, 'var(--sp-outflow)').color;
  const PaymentIcon = paid ? CircleCheck : CircleDashed;

  return (
    <RailHeroCard accent="var(--sp-outflow)" compact actions={actions}>
      <div className="detail-card-heading">
        <h3 className="calendar-detail-title">{String(bill.payee || bill.name || 'Recurring payment')}</h3>
        <RailDueBadge color={dueColor}>{paid ? <><Check size={11} aria-hidden="true" />Recorded</> : days === null ? 'Date unknown' : daysLabel(days)}</RailDueBadge>
      </div>
      <div className="detail-card-amount" data-unknown={amount === null ? 'true' : undefined}>{amount === null ? 'Amount unknown' : financeMoney(amount)}</div>
      <dl className="detail-card-facts">
        <RailFactRow label="Due" color={paid ? undefined : dueColor}><CalendarDays size={13} aria-hidden="true" /><span>{financeDate(date)}</span></RailFactRow>
        <RailFactRow label="Payment"><PaymentIcon size={13} aria-hidden="true" /><span>{paid ? 'Recorded in Actual' : 'Not recorded in Actual'}</span></RailFactRow>
      </dl>
    </RailHeroCard>
  );
}
