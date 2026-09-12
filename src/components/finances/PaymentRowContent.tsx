import { ArrowDownLeft, ArrowLeftRight, Check, ChevronRight, Clock3 } from 'lucide-react';
import { paymentStatusLabels } from './paymentPresentationModel';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import { financeDate, financeMoney } from './financeWorkspaceModel';
import { paymentRowDate } from './paymentLedgerSort';

const shortDate = (date: string | null) => date ? financeDate(date).replace(/, \d{4}$/, '') : '—';

/** Shared facts keep the editable row and its drag preview identical to the ledger. */
export default function PaymentRowContent({ row, name, editing = false }: { row?: PaymentPresentationRow; name?: string; editing?: boolean }) {
  const recorded = row && ['paid', 'received', 'transferred'].includes(row.status);
  const preview = row ? paymentRowDate(row) : null;
  const Icon = !row || ['scheduled', 'statement'].includes(row.status) ? Clock3 : row.direction === 'transfer' ? ArrowLeftRight : row.direction === 'income' ? ArrowDownLeft : Check;
  const status = !row ? 'No payment this month' : row.amountKind === 'statement' && row.status === 'scheduled' ? 'Statement received'
    : row.isCreditCard && row.amountKind === 'estimate' ? 'Awaiting statement' : paymentStatusLabels[row.status];
  return <>
    <span className="fin-status-name"><strong>{name || row?.name}</strong><span className="fin-status-label">{row && row.status !== 'unknown' && <Icon size={12} aria-hidden="true"/>}{status}</span>{!editing && row?.nextOccurrence && <small>Next {shortDate(row.nextOccurrence.next_date)} · {financeMoney(Math.round(Math.abs(row.nextOccurrence.amount) * 100))} estimated</small>}</span>
    <span className="fin-status-date"><small className="fin-mobile-label">Date</small>{preview ? <>{recorded ? paymentStatusLabels[row!.status] : row?.amountKind === 'statement' ? 'Due' : row?.direction === 'transfer' ? 'Scheduled' : 'Expected'} {shortDate(preview)}</> : '—'}{row && row.payments.length > 1 && <small>{row.payments.length} payments</small>}</span>
    <span className="fin-status-amount"><strong>{row?.amountCents == null ? '—' : financeMoney(row.amountCents)}</strong><small>{row?.amountKind === 'payment' ? row.direction === 'transfer' ? 'Actual transfer' : row.direction === 'income' ? 'Actual receipt' : 'Actual payment' : row?.amountKind === 'statement' ? 'Statement' : row?.amountKind === 'estimate' ? 'Estimate' : 'No amount'}</small></span>
    {!editing && <ChevronRight className="fin-row-chevron" size={14} aria-hidden="true"/>}
  </>;
}
