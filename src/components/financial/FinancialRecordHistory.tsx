import { useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, Clock3, History, Info, Mail, ReceiptText } from 'lucide-react';
import type { FinancialActivity, FinancialCorrectionHistory, FinancialOriginalReceipt } from '../../../shared/types/financial-activity';
import type { CorrectionSnapshot } from '../../../shared/types/financial-corrections';
import type { ActualMetadata } from '../../lib/actualMetadata';
import AnimatedCollapse from '../shared/AnimatedCollapse';
import useEmailBody from '../inbox/reader/useEmailBody';
import EmailBodyPane from '../inbox/reader/EmailBodyPane';
import { dateLabel, money, record } from './correctionPresentation';
import { SnapshotSummary } from './CorrectionPreview';

export function SourceEmail({ uid }: { uid:string }) {
  const email = { uid }; const state = useEmailBody(email);
  return <div className="mt-3 overflow-hidden rounded-md border border-white/10"><EmailBodyPane state={state} email={email} /></div>;
}
function SavedReceipt({ receipt, metadata }: { receipt:FinancialOriginalReceipt; metadata:ActualMetadata|null }) {
  const objects = receipt.evidence?.objects || [];
  const snapshot:CorrectionSnapshot = { budgetId:receipt.evidence?.budgetId || '', transactions:[],schedules:[],rules:[],dates:[],accounts:[],payees:[],categories:[],scheduleNames:[] };
  for (const item of objects) if (item.after) snapshot[item.kind === 'transaction' ? 'transactions' : item.kind === 'schedule' ? 'schedules' : item.kind === 'rule' ? 'rules' : 'dates'].push({ ...item.after,id:item.id });
  snapshot.accounts = metadata?.accounts || []; snapshot.payees = metadata?.payees || []; snapshot.categories = metadata?.categories || [];
  snapshot.scheduleNames = snapshot.schedules;
  const input = record(receipt.input); const operation = record(input.operation); const fields = record(operation.input || input.input || input);
  return <div className="financial-receipt">
    <div className="financial-receipt-header"><ReceiptText size={16} aria-hidden="true" /><div><strong>Saved result</strong><p>Captured <time dateTime={new Date(receipt.capturedAt).toISOString()}>{new Date(receipt.capturedAt).toLocaleString()}</time></p></div><span className="financial-receipt-outcome">{receipt.outcome.replace(/_/g,' ')}</span></div>
    {objects.length ? <SnapshotSummary snapshot={snapshot} transferLabel="Historical transfer" /> : <><dl className="financial-summary"><div><dt>Amount</dt><dd>{money(fields.amountCents)}</dd></div>{Boolean(fields.date) && <div><dt>Date</dt><dd>{dateLabel(fields.date)}</dd></div>}</dl><div className="financial-evidence-note"><Info size={16} aria-hidden="true" /><div><strong>Limited saved details</strong><p>Detailed original Actual fields were not captured.</p></div></div></>}
    {objects.some(object => object.beforeState === 'unknown') && <div className="financial-evidence-note" data-tone="limited"><History size={16} aria-hidden="true" /><div><strong>Earlier details unavailable</strong><p>Some details from before the original change were not captured. No earlier state is inferred.</p></div></div>}
  </div>;
}
type HistoryItem = { id:string; at:number|null } & (
  | { kind:'email'; uid:string; subject:string }
  | { kind:'receipt'; receipt:FinancialOriginalReceipt }
  | { kind:'correction'; correction:FinancialCorrectionHistory }
);
const correctionLabels = { applying:'Applying correction', recovering:'Checking correction outcome', attention:'Correction needs attention', completed:'Correction saved', superseded:'Earlier correction · continued' };
const stepLabels = { unattempted:'Not attempted', uncertain:'Outcome not yet known', applied:'Applied', no_write:'Confirmed unchanged', partial:'Partially applied', conflict:'Actual details conflict' };
function Timestamp({ at }: { at:number|null }) {
  return at === null ? <span>Date unavailable</span> : <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString(undefined, { month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit' })}</time>;
}
export default function FinancialRecordHistory({ activity,metadata,currentCorrection }: { activity:FinancialActivity; metadata:ActualMetadata|null; currentCorrection:FinancialCorrectionHistory|null }) {
  const [expanded,setExpanded] = useState<Set<string>>(() => new Set());
  const emails = activity.history?.emails || activity.emailUids.map(uid => ({ uid,subject:'Source email',receivedAt:null }));
  const corrections = [...(activity.history?.corrections || [])];
  if (currentCorrection && currentCorrection.id === activity.correction?.id) {
    const index = corrections.findIndex(item => item.id === currentCorrection.id);
    if (index < 0) corrections.push(currentCorrection); else corrections[index] = currentCorrection;
  }
  const items:HistoryItem[] = [
    ...emails.map(email => ({ id:`email:${email.uid}`,kind:'email' as const,at:email.receivedAt,uid:email.uid,subject:email.subject })),
    ...activity.originalReceipts.map(receipt => ({ id:`receipt:${receipt.reference.owner}:${receipt.reference.id}`,kind:'receipt' as const,at:receipt.capturedAt,receipt })),
    ...corrections.map(correction => ({ id:`correction:${correction.id}`,kind:'correction' as const,at:correction.updatedAt,correction })),
  ].sort((a,b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.id.localeCompare(b.id));
  const toggle = (id:string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <section className="financial-section financial-history" aria-label="Record history">
    <div className="financial-history-heading"><h3><History size={16} aria-hidden="true" />Record history</h3><span>{emails.length} source email{emails.length === 1 ? '' : 's'} · {corrections.length} correction{corrections.length === 1 ? '' : 's'}</span></div>
    {emails.length === 0 && <p className="financial-disclosure financial-note"><Mail size={15} aria-hidden="true" /><span>Source email unavailable. Saved evidence is retained.</span></p>}
    {items.length === 0 ? <p className="financial-note">No saved history is available yet.</p> : <ol className="financial-history-list">
      {items.map(item => {
        const correction = item.kind === 'correction' ? item.correction : null;
        const tone = correction ? correction.state === 'completed' ? 'success' : correction.state === 'superseded' ? 'muted' : 'attention' : item.kind === 'email' ? 'info' : 'muted';
        const Icon = item.kind === 'email' ? Mail : item.kind === 'receipt' ? ReceiptText : correction?.state === 'completed' ? CheckCircle2 : correction?.state === 'attention' ? CircleAlert : Clock3;
        const title = item.kind === 'email' ? 'Email received' : item.kind === 'receipt' ? item.receipt.captureKind === 'historical' ? 'Saved result captured' : 'Original result saved' : item.correction.resolution === 'kept_actual' ? 'Current Actual result kept' : correctionLabels[item.correction.state];
        return <li key={item.id} data-tone={tone}>
          <Icon className="financial-history-marker" size={16} aria-hidden="true" />
          <button className="financial-history-toggle" aria-expanded={expanded.has(item.id)} onClick={() => toggle(item.id)}><span><strong>{title}</strong><span className="financial-history-time"><Timestamp at={item.at} />{item.kind === 'correction' && ' · last update'}</span></span><ChevronDown size={14} aria-hidden="true" /></button>
          {item.kind === 'email' && <p className="financial-note">{item.subject}</p>}
          {correction?.predecessorId && <p className="financial-note">Continues an earlier correction on this record.</p>}
          <AnimatedCollapse open={expanded.has(item.id)}><div className="financial-history-detail">
            {item.kind === 'email' && <SourceEmail uid={item.uid} />}
            {item.kind === 'receipt' && <><div className="financial-evidence-note"><Info size={16} aria-hidden="true" /><div><strong>Historical snapshot</strong><p>This receipt shows the result saved at the time. Current Actual details may differ.</p></div></div><SavedReceipt receipt={item.receipt} metadata={metadata} /></>}
            {correction?.resolution === 'kept_actual' && <p className="financial-note">You kept the reviewed Actual result. The original attempted changes below retain their recorded outcomes.</p>}
            {correction && <ul className="financial-history-steps">{correction.steps.map((step,index) => <li key={index}><strong>Change {index + 1} · {stepLabels[step.state]}</strong><span>{step.attemptedAt === null ? 'No attempt recorded' : <>Attempted <Timestamp at={step.attemptedAt} /></>}</span></li>)}</ul>}
          </div></AnimatedCollapse>
        </li>;
      })}
    </ol>}
    {emails.some(email => email.receivedAt === null) && <p className="financial-note">Emails without a saved date appear last. Their order is unknown.</p>}
    {activity.runs.length > 0 && <div className="mt-3">
      <button type="button" className="financial-disclosure" aria-expanded={expanded.has('receipt-details')} onClick={() => toggle('receipt-details')}><ReceiptText size={14} />Receipt details<ChevronDown size={14} /></button>
      <AnimatedCollapse open={expanded.has('receipt-details')}><p className="financial-note">Batch created {new Date(activity.runs[0]!.createdAt).toLocaleString()} · {activity.occurrences.length} saved occurrence{activity.occurrences.length === 1 ? '' : 's'}</p></AnimatedCollapse>
    </div>}
  </section>;
}
