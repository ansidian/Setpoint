import { useState } from 'react';
import { paymentRowDate, sortPaymentRows } from './paymentLedgerSort';
import type { PaymentSort, PaymentSortColumn } from './paymentLedgerSort';
import { ArrowDown, ArrowUp, ArrowDownLeft, ArrowLeftRight, Check, ChevronRight, Clock3 } from 'lucide-react';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import { financeDate, financeMoney } from './financeWorkspaceModel';

const statusLabels = { paid: 'Paid', received: 'Received', transferred: 'Transferred', scheduled: 'Scheduled', nothing_due: 'Nothing due', unknown: 'Status unknown' };
const shortDate = (date: string | null) => date ? financeDate(date).replace(/, \d{4}$/, '') : '—';
export default function PaymentStatusList({ rows, today, selectedId, selectedDate, onPreview, onSelect }: {
  rows: PaymentPresentationRow[]; today: string; selectedId?: string; selectedDate: string | null;
  onPreview: (date: string | null) => void; onSelect: (row: PaymentPresentationRow) => void;
}) {
  const [sort,setSort]=useState<PaymentSort>({column:'date',direction:'asc'});
  const changeSort=(column:PaymentSortColumn)=>setSort(current=>({column,direction:current.column===column&&current.direction==='asc'?'desc':'asc'}));
  const columns=[{column:'name',label:'Name'}, {column:'date',label:'Date'}, {column:'amountCents',label:'Amount'}] as const;
  return <div className="fin-status-list">
    {(['utilities', 'recurring'] as const).map(group => {
      const grouped = rows.filter(row => row.group === group);
      const items = group==='recurring'?sortPaymentRows(grouped,sort,today):grouped;
      if (!items.length) return null;
      return <section key={group} className="fin-status-group" aria-label={group === 'utilities' ? 'Utilities' : 'Other recurring payments'}>
        <div className="fin-ledger-heading"><h2>{group === 'utilities' ? 'Utilities' : 'Other recurring payments'}<span>{items.length}</span></h2>
        <div className="fin-status-columns">{columns.map(({column,label})=>group==='recurring'?<button key={column} onClick={()=>changeSort(column)} aria-label={`Sort by ${label}, ${sort.column===column?sort.direction==='asc'?'ascending':'descending':'not sorted'}`}><span>{label}</span>{sort.column===column&&(sort.direction==='asc'?<ArrowUp size={12}/>:<ArrowDown size={12}/>)}</button>:<span key={column}>{label}</span>)}<span/></div>
        </div>{group==='recurring'&&<div className="fin-mobile-sort"><label>Sort by <select value={sort.column} onChange={event=>setSort({column:event.target.value as PaymentSortColumn,direction:'asc'})}>{columns.map(({column,label})=><option key={column} value={column}>{label}</option>)}</select></label><button onClick={()=>changeSort(sort.column)} aria-label={`Sort ${sort.direction==='asc'?'descending':'ascending'}`}>{sort.direction==='asc'?<ArrowUp size={16}/>:<ArrowDown size={16}/>}</button></div>}
        {items.map(row => {
          const recorded = ['paid', 'received', 'transferred'].includes(row.status);
          const preview = paymentRowDate(row);
          const Icon = row.status === 'scheduled' ? Clock3 : row.direction === 'transfer' ? ArrowLeftRight : row.direction === 'income' ? ArrowDownLeft : Check;
          return <button className="fin-status-row" key={row.id} data-finance-detail-trigger data-row-id={row.id} data-payment-date={preview}
            data-status={row.status} data-direction={row.direction} data-selected={!!preview && selectedDate === preview}
            aria-pressed={selectedId === row.id} aria-label={`${row.name}, ${statusLabels[row.status]}${row.dueDate ? `, due ${financeDate(row.dueDate)}` : ''}${row.paymentDate ? `, payment ${financeDate(row.paymentDate)}` : ''}, ${financeMoney(row.amountCents)}`}
            onMouseEnter={() => onPreview(preview)} onMouseLeave={() => onPreview(null)} onFocus={() => onPreview(preview)} onBlur={() => onPreview(null)} onClick={() => onSelect(row)}>
            <span className="fin-status-name"><strong>{row.name}</strong><span className="fin-status-label">{row.status !== 'unknown' && <Icon size={12} aria-hidden="true"/>}{statusLabels[row.status]}</span>{row.nextOccurrence && <small>Next {shortDate(row.nextOccurrence.next_date)} · {financeMoney(Math.round(Math.abs(row.nextOccurrence.amount) * 100))} estimated</small>}</span>
            <span className="fin-status-date"><small className="fin-mobile-label">Date</small>{preview?<>{recorded?statusLabels[row.status]:'Due'} {shortDate(preview)}</>:'—'}{row.payments.length>1&&<small>{row.payments.length} payments</small>}</span>
            <span className="fin-status-amount"><strong>{row.amountCents === null ? '—' : financeMoney(row.amountCents)}</strong><small>{row.amountKind === 'payment' ? row.direction === 'transfer' ? 'Actual transfer' : row.direction === 'income' ? 'Actual receipt' : 'Actual payment' : row.amountKind === 'statement' ? 'Statement' : row.amountKind === 'estimate' ? 'Estimate' : 'No amount'}</small></span>
            <ChevronRight className="fin-row-chevron" size={14} aria-hidden="true"/>
          </button>;
        })}
      </section>;
    })}
    {!rows.length && <p className="fin-empty">No matching bills or payments in this month.</p>}
  </div>;
}
