import { transactionImportSourceLabel } from "./transactionImportReviewModel";
import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarDays, CheckCircle2, CircleAlert, CircleMinus, Clock3 } from 'lucide-react';
import AnimatedCollapse from '../shared/AnimatedCollapse';
import AnimatedHeight from '../shared/AnimatedHeight';
import type { FinancialActivity, FinancialCorrectionHistory } from '../../../shared/types/financial-activity';
import type { FinancialEmailPlan } from '../../../shared/types/bills';
import { ensureMetadataLoaded, type ActualMetadata } from '../../lib/actualMetadata';
import FinancialBindingRepair from './FinancialBindingRepair';
import FinancialCorrectionEditor from './FinancialCorrectionEditor';
import PendingFinancialRecord from './PendingFinancialRecord';
import { dateLabel, money, record, rows, typeLabels } from './correctionPresentation';
import FinancialRecordHistory from './FinancialRecordHistory';
import { ActualResultSnapshot } from './KeepActualResult';
import type { CorrectionSnapshot } from '../../../shared/types/financial-corrections';
import { activityOutcome } from './financialActivityPresentation';

export default function FinancialRecord({ activity,onDirty,onChanged,onRepair,registerBack,requestDiscard }: {
  requestDiscard:(action:()=>void)=>void; activity:FinancialActivity; onDirty:(dirty:boolean)=>void; onChanged:()=>void; onRepair:()=>void; registerBack:(back:(()=>boolean)|null)=>void;
}) {
  const [editing,setEditing] = useState(false);
  const [confirmingImport,setConfirmingImport] = useState(false);
  const [currentCorrection,setCurrentCorrection] = useState<FinancialCorrectionHistory|null>(null);
  const [metadata,setMetadata] = useState<ActualMetadata|null>(null);
  useEffect(() => { let active = true; ensureMetadataLoaded(value => { if (active) setMetadata(value); }); return () => { active = false; }; },[]);
  const effective = record(activity.effectiveResult); const entry = record(effective.entry);
  const kept = effective.resolution === 'kept_actual';
  const original = activity.originalReceipts[0]; const saved = record(original?.input); const operation = record(saved.operation); const input = record(operation.input || saved.input || saved);
  const capturedPlan = record(saved.plan || saved);
  const plan = original ? (capturedPlan.candidate && capturedPlan.targets ? capturedPlan as unknown as FinancialEmailPlan : null) : activity.completionPlan;
  const objects = rows(record(effective.evidence).objects).length ? rows(record(effective.evidence).objects) : (original?.evidence?.objects || []).map(object => record(object));
  const transaction = record(objects.find(object => object.kind === 'transaction' && object.role === 'primary')?.after);
  const schedule = record(objects.find(object => object.kind === 'schedule')?.after);
  const from = entry.fromAccountId || input.fromAccountId || (transaction.transferred_id ? record(objects.find(object => object.kind === 'transaction' && Number(record(object.after).amount) < 0)?.after).acct : '') || plan?.targets.fromAccount.id;
  const counterpart = record(objects.find(object => object.kind === 'transaction' && object.id === transaction.transferred_id)?.after);
  const to = entry.toAccountId || input.toAccountId || (transaction.transferred_id ? record(objects.find(object => object.kind === 'transaction' && Number(record(object.after).amount) > 0)?.after).acct : counterpart.acct) || plan?.targets.toAccount.id;
  const scheduledTransfer = entry.type === 'transfer_schedule' || !entry.type && (operation.executor === 'transfer_schedule' || input.kind === 'transfer_schedule' || plan?.operation.intended === 'create_transfer_schedule');
  const kind = String(kept && !entry.type ? 'kept' : scheduledTransfer ? 'transfer_schedule' : entry.type || input.type || (from && to ? 'transfer' : schedule.id ? 'bill' : Number(transaction.amount) > 0 ? 'income' : plan?.candidate.type || 'payment'));
  const label = kept && !entry.type ? 'Kept result' : scheduledTransfer ? 'Scheduled transfer' : typeLabels[kind as keyof typeof typeLabels] || 'One-time payment';
  const accountName = (id:unknown, fallback?:string|null) => metadata?.accounts.find(account => account.id === id)?.name || fallback || (id ? 'Account name unavailable' : 'Not captured');
  const payee = String(entry.payee || activity.payee || plan?.targets.payee.label || activity.subject || 'Financial record');
  const date = dateLabel(entry.date || transaction.date || input.date || plan?.candidate.due_date || (!original ? activity.importItem?.date : null) || schedule.next_date || record(objects.find(object => object.kind === 'schedule_next_date')?.after).local_next_date);
  const TypeIcon = kind === 'transfer' || scheduledTransfer ? ArrowLeftRight : kind === 'bill' ? CalendarDays : kind === 'income' ? ArrowDownLeft : ArrowUpRight;
  const StatusIcon = activity.status === 'completed' ? CheckCircle2 : activity.status === 'processing' ? Clock3 : activity.status === 'dismissed' ? CircleMinus : CircleAlert;
  const completing = activity.status === 'needs_attention' && activity.actions.complete;
  return <article aria-label={payee} data-record-type={kind}>
    <div className="financial-record-heading"><TypeIcon className="financial-type-icon" size={20} aria-hidden="true" /><h3 tabIndex={-1} className="outline-none text-base font-semibold break-words">{payee}</h3>{!confirmingImport && <span className="financial-record-amount">{money(activity.amountCents)}</span>}</div>
    <p className="financial-record-meta"><span className="financial-status" data-tone={activity.status === 'completed' ? 'success' : activity.status === 'dismissed' || activity.status === 'processing' ? 'muted' : 'attention'}><StatusIcon size={13} aria-hidden="true" />{activity.status === 'completed' ? 'Completed' : activity.status === 'processing' ? 'Processing' : activity.status === 'dismissed' ? 'Dismissed' : 'Needs attention'}</span><span>{activity.source === 'managed' ? 'Financial email' : `${transactionImportSourceLabel(activity.source)} import`}</span><span>{label}</span></p>
    <AnimatedCollapse open={!editing && !confirmingImport && !completing}><div>
    {kept ? <><ActualResultSnapshot snapshot={effective.snapshot as CorrectionSnapshot}/><p className="financial-note">This is the result you chose to keep. Actual may have changed since it was saved.</p></> : <dl className="financial-summary">
      {(kind === 'transfer' || scheduledTransfer) && <div><dt>From account</dt><dd>{accountName(from,plan?.targets.fromAccount.label)}</dd></div>}
      <div><dt>{kind === 'bill' ? 'Due date' : 'Date'}</dt><dd>{date || 'Not captured'}</dd></div>
      {kind === 'transfer' || scheduledTransfer ? <div><dt>To account</dt><dd>{accountName(to,plan?.targets.toAccount.label)}</dd></div> : <><div><dt>Account</dt><dd>{accountName(entry.accountId || transaction.acct || input.accountId || plan?.targets.account.id || (!original ? activity.importItem?.actualAccountId : null),plan?.targets.account.label)}</dd></div><div><dt>Category</dt><dd>{metadata?.categories.find(category => category.id === (entry.categoryId || transaction.category || (!original ? activity.importItem?.actualCategoryId : null)))?.name || (!activity.correction ? plan?.targets.category.label : null) || 'No captured category'}</dd></div></>}
    </dl>}
    {!activity.correction && <p className={activity.status === 'completed' ? 'financial-result-summary' : 'financial-note'}>{activity.status === 'completed' ? activityOutcome(activity) : activity.status === 'dismissed' ? 'Removed from review.' : activity.reason === 'ready' ? 'Review the details before recording in Actual.' : activity.reason}</p>}
    </div></AnimatedCollapse>
    {activity.status === "completed" && !activity.actions.correct && !activity.correction && activity.reference.owner === "import" && !activity.identityConflict && <FinancialBindingRepair activity={activity} onChanged={onChanged} onRepair={onRepair} />}
    {(activity.actions.correct || activity.correction) && <FinancialCorrectionEditor onHistoryChange={setCurrentCorrection} onEditing={setEditing} activity={activity} onDirty={onDirty} onChanged={onChanged} onRepair={onRepair} registerBack={registerBack} requestDiscard={requestDiscard} />}
    {(activity.actions.complete || activity.actions.retry) && <AnimatedHeight><div className="mt-5 p-1"><PendingFinancialRecord onConfirming={setConfirmingImport} activity={activity} onDirty={onDirty} onChanged={onChanged} onRepair={onRepair} requestDiscard={requestDiscard} /></div></AnimatedHeight>}
    {activity.status === 'completed' && !activity.actions.correct && !activity.actions.complete && !activity.actions.retry && !activity.correction && <p className="financial-note mt-4">This saved result is available for inspection. An exact supported Actual target is required before correction.</p>}
    <FinancialRecordHistory activity={activity} metadata={metadata} currentCorrection={currentCorrection} />
  </article>;
}
