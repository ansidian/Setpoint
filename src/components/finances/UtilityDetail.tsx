import Dropdown from "../shared/Dropdown";
import { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, ReceiptText, X } from 'lucide-react';
import type { FinanceUtility, UtilityStatement } from '../../../shared/types/finances';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney, monthStatement, statementComparison, statementMonths } from './financeWorkspaceModel';
import { SourceEmail } from '../financial/FinancialRecordHistory';
import { financialHref } from '../financial/financialNavigation';
import AnimatedCollapse from '../shared/AnimatedCollapse';

export default function UtilityDetail({ utility, month, statementId, end, onNavigate, onForeground, onClose }: {
  utility:FinanceUtility; month:string; statementId?:string; end:string;
  onNavigate:(target:FinanceDestination)=>void; onForeground:(href:string)=>void; onClose:()=>void;
}) {
  const [historyOpen,setHistoryOpen] = useState(true);
  const [emailOpen,setEmailOpen] = useState<string|null>(null);
  const statement = statementId ? utility.statements.find(row => row.id === statementId) || null : monthStatement(utility.statements,month);
  const sameMonth = utility.statements.filter(row => row.dueDate?.startsWith(month));
  const months = statementMonths(end > `${month}-01` ? end : `${month}-01`);
  const amounts = months.map(key => monthStatement(utility.statements,key)?.amountCents ?? null);
  const max = Math.max(1,...amounts.filter((amount):amount is number => amount !== null));
  const choose = (key:string,id?:string) => onNavigate({ view:'utilities',utilityId:utility.identity.id,month:key,statementId:id });
  const occurrence = utility.occurrences.find(row => row.next_date.startsWith(month));
  const paymentIds = statement?.paymentTransactionIds || [];
  const paid = !!statement?.paymentRecorded || paymentIds.length > 0;
  const title = statement && !statement.dueDate ? 'Account notice' : `${new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US',{month:'long',year:'numeric'})} bill`;
  const history = statement ? [statement] : sameMonth;
  const otherNotices = utility.statements.filter(row => !row.dueDate && row.id !== statement?.id);
  return <article className="fin-utility-detail" style={{'--fin-amount-color':paid?'var(--sp-income)':'var(--sp-outflow)'} as React.CSSProperties}>
    <header className="fin-detail-heading"><div><h2>{utility.identity.label}</h2><p>{utility.identity.provider}</p></div><button onClick={onClose} aria-label="Close utility details"><X size={16} /></button></header>
    <section className="fin-bill-hero" aria-label={title}>
      <div className="fin-between"><span>{title}</span><span className={paid ? 'fin-paid' : statement?.dueDate && !statement.nothingDue ? 'fin-due' : ''}>{statement?.nothingDue ? 'Nothing due' : paid ? statement?.paymentDate ? `Paid ${financeDate(statement.paymentDate)}` : 'Paid' : statement?.dueDate ? `Due ${financeDate(statement.dueDate)}` : 'Statement unavailable'}</span></div>
      <div className="fin-bill-amount">{statement ? financeMoney(statement.amountCents) : 'Unavailable'}{statement?.nothingDue && <span> due</span>}</div>
      {statement?.creditCents != null && <p>{financeMoney(statement.creditCents)} account credit</p>}
      <p>{statementComparison(statement,utility.statements)}</p>
      <p className={paid ? 'fin-paid' : 'fin-muted'}>{statement?.nothingDue ? 'No payment is required by this notice.' : paid ? `Recorded in Actual${statement?.recordedTotalCents != null ? ` · ${financeMoney(statement.recordedTotalCents)}` : ''}` : 'Exact payment link unavailable'}</p>
      {!statement && occurrence && <p>Schedule estimate: {financeMoney(Math.round(occurrence.amount * 100))} · due {financeDate(occurrence.next_date)}. This is not a saved statement.</p>}
      {!statement && sameMonth.length > 1 && <p>Multiple statements in this month. Select a source below; no combined amount is inferred.</p>}
    </section>
    <div className="fin-between fin-period"><h3>Billed over the year</h3><div className="fin-month-dropdown"><Dropdown ariaLabel="Bill month" value={month} onChange={choose} options={months.map(key => ({ id:key,name:new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US',{month:'short',year:'numeric'}) }))} /></div></div>
    <div className="fin-chart" role="group" aria-label="Select a monthly bill">
      {months.map((key,index)=><button key={key} aria-pressed={key===month && !statementId} aria-label={`${key}: ${financeMoney(amounts[index] ?? null)}`} onClick={()=>choose(key)}><span className="fin-bar-space">{amounts[index] != null && <i style={{height:`${Math.max(2,amounts[index]!/max*100)}%`}} />}</span><span className="fin-month-label">{new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US',{month:'short'})}</span></button>)}
    </div>
    {paymentIds.length > 0 && <button className="fin-link" onClick={()=>onNavigate({view:'journal',date:statement!.paymentDate || undefined,transactionId:paymentIds[0]})}>View payment in Journal <ArrowRight size={14}/></button>}
    <section className="fin-history"><button className="fin-disclosure" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(value=>!value)}><span className="fin-history-title"><ChevronDown size={14} className="fin-disclosure-chevron"/><span>Statement &amp; record history</span></span><span>{statement && !statement.dueDate ? 'Account notice' : new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span></button>
      <AnimatedCollapse open={historyOpen}><div className="fin-history-content">
        {!history.length && <p>No statement available for this due month.</p>}
        {history.map(row=><StatementHistory key={row.id} statement={row} provider={utility.identity.provider} expanded={emailOpen===row.id} onEmail={()=>setEmailOpen(emailOpen===row.id ? null : row.id)} onRecord={()=>row.activity && onForeground(financialHref({},row.activity))} onSelect={history.length>1 ? ()=>choose(month,row.id) : undefined}/>)}
        {otherNotices.length > 0 && <section className="fin-notices" aria-label={statement ? 'Other notices' : 'Account notices'}><h3>{statement ? 'Other notices' : 'Account notices'}</h3>{otherNotices.map(row=><button className="fin-notice-row" key={row.id} onClick={()=>choose(month,row.id)}><ReceiptText size={16} aria-hidden="true"/><span><strong>{row.nothingDue ? 'No payment required' : row.subject}</strong><small>{row.statementDate ? 'Dated' : 'Received'} {financeDate(row.statementDate || row.receivedAt)}{row.creditCents != null ? ` · ${financeMoney(row.creditCents)} credit` : ''}</small></span><ChevronRight size={14} aria-hidden="true"/></button>)}</section>}
      </div></AnimatedCollapse>
    </section>
  </article>;
}
function StatementHistory({statement:row,provider,expanded,onEmail,onRecord,onSelect}:{statement:UtilityStatement;provider:string;expanded:boolean;onEmail:()=>void;onRecord:()=>void;onSelect?:()=>void}) {
  const events = [
    {date:row.receivedAt,title:'Statement received',detail:`${provider} · source email`,paid:false},
    ...(row.paymentDate ? [{date:row.paymentDate,title:'Payment recorded',detail:row.recordedTotalCents != null ? `${financeMoney(row.recordedTotalCents)} recorded in Actual` : 'Recorded in Actual',paid:true}] : []),
  ].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  return <section className="fin-statement" aria-label="Statement summary"><div className="fin-statement-heading"><div><strong>{provider}</strong><p className="fin-statement-caption">{row.subject}</p></div><span className="fin-statement-format">Email</span></div>
    {onSelect && <button className="fin-link" onClick={onSelect}>Select statement <ArrowRight size={14}/></button>}
    <dl className="fin-statement-facts"><div><dt>Amount billed</dt><dd>{financeMoney(row.amountCents)}</dd></div><div><dt>Due date</dt><dd>{row.nothingDue && !row.dueDate ? 'Not required' : financeDate(row.dueDate)}</dd></div><div><dt>Received</dt><dd>{financeDate(row.receivedAt)}</dd></div></dl>
    {row.originalStatement && <p>Original statement: {financeMoney(row.originalStatement.amountCents)} · due {financeDate(row.originalStatement.dueDate)}. Saved bill correction shown above.</p>}
    {row.statementDate && <p>Statement dated {financeDate(row.statementDate)}</p>}
    {row.newChargesCents != null && <p>New charges: {financeMoney(row.newChargesCents)}</p>}{row.carriedBalanceCents != null && <p>Earlier balance: {financeMoney(row.carriedBalanceCents)}</p>}
    {row.feeCents != null && row.feeCents > 0 && <p>Processing fee: {financeMoney(row.feeCents)} · recorded total {financeMoney(row.recordedTotalCents)}</p>}
    {row.issue && <p>{row.issue}</p>}
    <button className="fin-link fin-source-toggle" aria-expanded={expanded} onClick={onEmail}><ChevronRight size={13} className="fin-disclosure-chevron"/>Read source email</button><AnimatedCollapse open={expanded}>{expanded && <SourceEmail uid={row.emailUid}/>}</AnimatedCollapse>
    <section className="fin-record-trail" aria-label="Record activity"><h3>Activity</h3><ol>{events.map(event=><li className="fin-history-event" data-paid={event.paid} key={event.title}><time dateTime={event.date} title={financeDate(event.date)} aria-label={financeDate(event.date)}>{financeDate(event.date).replace(/, \d{4}$/, '')}</time><span className="fin-history-dot" aria-hidden="true"/><div><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol></section>
    {row.activity ? <button className="fin-link" onClick={onRecord}>View saved record and corrections <ArrowRight size={14}/></button> : <p className="fin-muted">Saved Actual record link unavailable</p>}
  </section>;
}
