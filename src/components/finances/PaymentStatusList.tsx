import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import type { PaymentOrganization } from '../../../shared/types/payment-groups';
import { paymentRowDate, sortPaymentRows } from './paymentLedgerSort';
import type { PaymentSort, PaymentSortColumn } from './paymentLedgerSort';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import { financeDate, financeMoney } from './financeWorkspaceModel';
import PaymentRowContent from './PaymentRowContent';
import { paymentStatusLabels } from './paymentPresentationModel';
import './payment-groups.css';

export default function PaymentStatusList({ rows, organization, today, selectedId, selectedDate, onPreview, onSelect }: {
  rows: PaymentPresentationRow[]; organization: PaymentOrganization; today: string; selectedId?: string; selectedDate: string | null;
  onPreview: (date: string | null) => void; onSelect: (row: PaymentPresentationRow) => void;
}) {
  const [sort, setSort] = useState<PaymentSort | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const changeSort = (column: PaymentSortColumn) => setSort(current => current?.column === column && current.direction === 'desc' ? null : { column, direction: current?.column === column ? 'desc' : 'asc' });
  const columns = [{ column: 'name', label: 'Name' }, { column: 'date', label: 'Date' }, { column: 'amountCents', label: 'Amount' }] as const;
  return <div className="fin-status-list fin-configured-groups">
    {organization.groups.map(group => {
      const grouped = group.itemIds.flatMap(id => rows.filter(row => id === (row.utilityId ? `utility:${row.utilityId}` : `schedule:${row.scheduleId}`)));
      const items = sort ? sortPaymentRows(grouped, sort, today) : grouped;
      if (!items.length) return null;
      const collapsed = closed.has(group.id);
      return <section key={group.id} className="fin-status-group" aria-label={group.name}>
        <div className="fin-ledger-heading"><h2><button className="fin-group-disclosure" aria-expanded={!collapsed} onClick={() => setClosed(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><ChevronDown size={14} aria-hidden="true"/>{group.name}<span>{new Set(items.map(row => row.utilityId || row.scheduleId)).size}</span></button></h2>
          {!collapsed && <div className="fin-status-columns">{columns.map(({ column, label }) => <button key={column} onClick={() => changeSort(column)} aria-label={`Sort by ${label}, ${sort?.column === column ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'saved order'}`}><span>{label}</span>{sort?.column === column && (sort.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>)}</button>)}<span/></div>}
        </div>
        {!collapsed && items.map(row => {
          const preview = paymentRowDate(row);
          return <button className="fin-status-row" key={row.id} data-finance-detail-trigger data-row-id={row.id} data-payment-date={preview}
            data-status={row.status} data-direction={row.direction} data-selected={!!preview && selectedDate === preview}
            aria-pressed={selectedId === row.id} aria-label={`${row.name}, ${paymentStatusLabels[row.status]}${row.dueDate ? `, due ${financeDate(row.dueDate)}` : ''}${row.paymentDate ? `, payment ${financeDate(row.paymentDate)}` : ''}, ${financeMoney(row.amountCents)}`}
            onMouseEnter={() => onPreview(preview)} onMouseLeave={() => onPreview(null)} onFocus={() => onPreview(preview)} onBlur={() => onPreview(null)} onClick={() => onSelect(row)}><PaymentRowContent row={row}/></button>;
        })}
      </section>;
    })}
    {!rows.length && <p className="fin-empty">No matching bills or payments in this month.</p>}
  </div>;
}
