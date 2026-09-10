import { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import type { UtilityStatement } from '../../../shared/types/finances';
import { financeDate, financeMoney, statementComparison } from './financeWorkspaceModel';
import { SourceEmail } from '../financial/FinancialRecordHistory';
import { financialHref } from '../financial/financialNavigation';
import AnimatedCollapse from '../shared/AnimatedCollapse';

/** Source statements supplement recorded payments; their absence never hides payment facts. */
export default function UtilityDetail({ statements, provider, onForeground }: {
  statements: UtilityStatement[]; provider: string; onForeground: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState<string | null>(null);
  if (!statements.length) return null;
  return <section className="fin-history">
    <button className="fin-disclosure" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="fin-history-title"><ChevronDown size={14} className="fin-disclosure-chevron"/><span>Statements &amp; source emails</span></span><span>{statements.length}</span>
    </button>
    <AnimatedCollapse open={open}><div className="fin-history-content">
      {statements.map(statement => {
        const comparison = statementComparison(statement, statements);
        return <div key={statement.id}>
          {comparison !== 'Previous comparable bill unavailable' && <p className="fin-muted">{comparison}</p>}
          <StatementHistory statement={statement} provider={provider} expanded={emailOpen === statement.id}
            onEmail={() => setEmailOpen(emailOpen === statement.id ? null : statement.id)}
            onRecord={() => statement.activity && onForeground(financialHref({}, statement.activity))}/>
        </div>;
      })}
    </div></AnimatedCollapse>
  </section>;
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
    {row.activity ? <button className="fin-link" onClick={onRecord}>View saved record and corrections <ArrowRight size={14}/></button> : null}
  </section>;
}
