import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Landmark, Trash2, Wallet } from 'lucide-react';
import PaymentConfirmation from './PaymentConfirmation';
import Dropdown from '../shared/Dropdown';
import DateField from '../shared/pickers/DateField';
import SearchableDropdown from '../shared/SearchableDropdown';
import AnimatedCollapse from '../shared/AnimatedCollapse';
import type { FinancialActivity } from '../../../shared/types/financial-activity';
import type { TransactionImportConfirmation } from '../../../shared/types/transaction-imports';
import { commitTransactionImportItems, dismissTransactionImportItem, retryTransactionImportItem } from '../../api';
import { ensureMetadataLoaded, invalidateActualMetadata, type ActualMetadata } from '../../lib/actualMetadata';
import FinancialEventCompletionForm from '../bills/FinancialEventCompletionForm';
import { isIndividuallyReviewable, itemToConfirmation } from './transactionImportReviewModel';

interface Props {
  activity: FinancialActivity;
  onChanged: () => void;
  onAccepted: () => void;
  onDirty: (dirty: boolean) => void;
  onRepair: () => void;
  onConfirming: (confirming:boolean) => void;
  requestDiscard: (action:()=>void) => void;
}

export default function PendingFinancialRecord(props: Props) {
  const { activity, onDirty, onRepair, requestDiscard } = props;
  useEffect(() => () => onDirty(false),[onDirty]);
  const [editing, setEditing] = useState(true);
  if (activity.reference.owner === 'import') return <ImportCompletion {...props} />;
  const plan = activity.completionPlan;
  if (!activity.actions.complete || !plan?.workflow?.completion) return <p className="financial-note">{activity.reason}</p>;
  return editing ? <FinancialEventCompletionForm plan={plan} onDirty={onDirty} onRepair={onRepair} onConfirming={props.onConfirming}
    onCancel={() => requestDiscard(() => { setEditing(false); onDirty(false); })} onQueued={() => { props.onAccepted(); onDirty(false); }} />
    : <button type="button" className="financial-button" onClick={() => setEditing(true)}>Complete record</button>;
}

function ImportCompletion({ activity, onAccepted, onChanged, onDirty, onRepair, onConfirming }: Props) {
  const item = activity.importItem!;
  const [draft, setDraft] = useState(() => itemToConfirmation(item));
  const [amount, setAmount] = useState(item.amountCents == null ? '' : String(Math.abs(item.amountCents) / 100));
  const [direction, setDirection] = useState(item.amountCents != null && item.amountCents > 0 ? 'inflow' : 'outflow');
  const signedAmount = Math.round(Number(amount) * 100) * (direction === 'inflow' ? 1 : -1);
  const values = JSON.stringify([direction,amount === '' ? '' : Number(amount),draft.date || '',draft.payee || '',draft.actualAccountId || '',draft.actualCategoryId || '',draft.notes || '']);
  const [baseline] = useState(values);
  const [metadata, setMetadata] = useState<ActualMetadata | null>(null);
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    onConfirming(confirming);
    return () => onConfirming(false);
  },[confirming,onConfirming]);
  const backToDetails = () => { setConfirming(false); requestAnimationFrame(() => reviewTrigger.current?.focus()); };
  const dismissTrigger = useRef<HTMLButtonElement>(null);
  const keepCandidate = () => { setDismissing(false); requestAnimationFrame(() => dismissTrigger.current?.focus()); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => { onDirty(!result && values !== baseline); },[values,baseline,result,onDirty]);
  useEffect(() => {
    let active = true;
    ensureMetadataLoaded(value => { if (active) setMetadata(value); });
    return () => { active = false; };
  }, [reload]);
  const accounts = metadata?.accounts.filter(account => !account.closed) || [];
  const payeeOptions = [...new Set((metadata?.payees || []).filter(payee => !payee.transfer_acct).map(payee => payee.name))].map(name => ({ id:name,name }));
  const transfer = item.financialPlan?.candidate.type === 'transfer';
  const reviewable = activity.actions.complete && isIndividuallyReviewable(item) && !transfer;
  const valid = Number.isSafeInteger(Math.round(Number(amount) * 100)) && Number(amount) > 0 && !!amount
    && !!draft.date && !!draft.payee?.trim() && draft.payee.trim().length <= 200 && accounts.some(account => account.id === draft.actualAccountId);
  function patch(value: Partial<TransactionImportConfirmation>) {
    setDraft(current => ({ ...current, ...value })); setConfirming(false);
  }
  async function perform(action: 'commit' | 'retry' | 'dismiss') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'commit') {
        const result = await commitTransactionImportItems(item.runId, [{ ...draft, amountCents: signedAmount }]);
        if (result.accepted !== 1) { onChanged(); throw new Error('This confirmation was not accepted. Check the refreshed record before trying again. Your details are retained.'); }
      }
      if (action === 'retry') {
        const result = await retryTransactionImportItem(item.id);
        if (!result.accepted) { onChanged(); throw new Error('This retry was not accepted. Check the refreshed record before trying again.'); }
      }
      if (action === 'dismiss') await dismissTransactionImportItem(item.id);
      setConfirming(false); setResult(action === 'dismiss' ? 'This candidate was dismissed.' : 'Queued for Actual. The result will appear when processing finishes.');
      onDirty(false);
      if (action === 'dismiss') onChanged();
      else onAccepted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this record. Your details are still here.'); }
    finally { setBusy(false); }
  }
  function preview(event: FormEvent) { event.preventDefault(); if (valid) setConfirming(true); }
  if (result) return <p role="status" className="financial-note">{result}</p>;
  return <div className="space-y-4">
    {transfer && <div className="financial-note"><p>This transfer keeps its original plan. Review its accounts before resuming.</p><dl className="financial-summary">
      <div><dt>From account</dt><dd>{item.financialPlan?.targets.fromAccount.label || 'Unresolved'}</dd></div>
      <div><dt>To account</dt><dd>{item.financialPlan?.targets.toAccount.label || 'Unresolved'}</dd></div>
    </dl></div>}
    {reviewable && (confirming ? <>
      <PaymentConfirmation amountCents={signedAmount} account={accounts.find(account => account.id === draft.actualAccountId)?.name || 'Account unavailable'} payee={draft.payee || ''} date={draft.date || ''} category={draft.actualCategoryId ? metadata?.categories.find(category => category.id === draft.actualCategoryId)?.name || 'Unavailable category' : undefined} notes={draft.notes || undefined} />
      <div className="financial-actions"><button type="button" className="financial-button financial-back" disabled={busy} onClick={backToDetails}><ArrowLeft size={14} />Back to details</button>
        <button type="button" className="financial-button financial-primary" disabled={busy || !valid} onClick={() => void perform('commit')}>{busy ? 'Confirming…' : 'Record in Actual'}</button></div>
    </> : <form onSubmit={preview} inert={dismissing} className="space-y-4" aria-label="Complete financial record">
      <p className="financial-note">Review the transaction details. Category is optional.</p>
      <div className="financial-field"><span>Direction</span><Dropdown ariaLabel="Direction" disabled={busy} value={direction} onChange={value => { setDirection(value); setConfirming(false); }} options={[{ id:"outflow",name:"Outflow — money out" },{ id:"inflow",name:"Inflow — money in" }]} /></div>
      <div className="financial-fields">
        <div className="financial-field"><span>Date</span><DateField ariaLabel="Date" value={draft.date || ''} disabled={busy} onChange={date => patch({ date })} /></div>
        <label className="financial-field"><span className="financial-field-label"><Wallet size={13} aria-hidden="true" />{direction === 'inflow' ? 'Inflow' : 'Outflow'} amount (USD)</span><input type="number" min="0.01" step="0.01" required value={amount} disabled={busy} onChange={event => { setAmount(event.target.value); setConfirming(false); }} /></label>
        <div className="financial-field"><span>Payee</span><SearchableDropdown ariaLabel="Payee" options={payeeOptions} value={draft.payee} onChange={payee => patch({ payee })} allowCreate disabled={busy} placeholder="Choose or add a payee" />{(draft.payee?.trim().length || 0) > 200 && <p role="status" className="financial-error">Payee must be 200 characters or fewer.</p>}</div>
        <div className="financial-field"><span className="financial-field-label"><Landmark size={13} aria-hidden="true" />Account</span><SearchableDropdown ariaLabel="Account" options={accounts} value={draft.actualAccountId} disabled={busy} onChange={actualAccountId => patch({ actualAccountId })} placeholder="Choose an account" /></div>
        <div className="financial-field"><span>Category (optional)</span><SearchableDropdown ariaLabel="Category (optional)" options={[{ id:"",name:"No category" },...(metadata?.categories || []).map(category => ({ id:category.id,name:category.group ? `${category.group} / ${category.name}` : category.name }))]} value={draft.actualCategoryId || ""} disabled={busy} onChange={actualCategoryId => patch({ actualCategoryId:actualCategoryId || null })} placeholder="No category" /></div>
        <label className="financial-field">Notes (optional)<textarea maxLength={2000} value={draft.notes || ''} disabled={busy} onChange={event => patch({ notes: event.target.value })} /></label>
      </div>
      <p className="financial-note">Enter a positive amount; no minus sign needed. Direction determines whether money enters or leaves the account.</p>
      <button ref={reviewTrigger} type="submit" className="financial-button financial-primary" disabled={!valid || busy}>Review before sending</button>
    </form>)}
    {!metadata && reviewable && <p role="status" className="financial-note">Loading Actual accounts…</p>}
    {metadata && !accounts.length && reviewable && <div className="space-y-2"><p className="financial-note">Actual accounts are unavailable. Your draft stays here while you repair the connection.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="financial-button" onClick={onRepair}>Repair Actual connection</button>
        <button type="button" className="financial-button" onClick={() => { invalidateActualMetadata(); setMetadata(null); setReload(value => value + 1); }}>Reload accounts</button></div></div>}
    {error && <div role="alert" className="financial-error"><p>{error}</p><button type="button" className="financial-button" onClick={onRepair}>Check Actual connection</button></div>}
    <div className="flex flex-wrap gap-2">
      {activity.actions.retry && <button type="button" className="financial-button" disabled={busy || dismissing} onClick={() => void perform('retry')}>{busy ? 'Resuming…' : 'Resume processing'}</button>}
      {activity.actions.complete && isIndividuallyReviewable(item) && !dismissing && !confirming && <button ref={dismissTrigger} type="button" className="financial-button financial-danger" disabled={busy} onClick={() => { setConfirming(false); setDismissing(true); }}><Trash2 size={14} />Dismiss candidate</button>}
    </div>
    <AnimatedCollapse open={dismissing}><section className="financial-dismiss" aria-label="Dismiss candidate confirmation" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); keepCandidate(); } }}>
      <h3><Trash2 size={15} />Dismiss this candidate?</h3><p className="financial-note">Remove it from review without sending it to Actual. Any unsaved edits will be discarded.</p>
      <div className="financial-actions"><button type="button" autoFocus className="financial-button financial-back" disabled={busy} onClick={keepCandidate}>Keep candidate</button><button type="button" className="financial-button financial-danger" disabled={busy} onClick={() => void perform('dismiss')}><Trash2 size={14} />{busy ? 'Dismissing…' : 'Dismiss candidate'}</button></div>
    </section></AnimatedCollapse>
    {!reviewable && !activity.actions.retry && <p className="financial-note">{activity.reason}</p>}
  </div>;
}
