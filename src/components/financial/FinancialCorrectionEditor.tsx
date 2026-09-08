import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleAlert, Eye, Pencil, RefreshCw } from 'lucide-react';
import AnimatedHeight from '../shared/AnimatedHeight';
import AnimatedCollapse from '../shared/AnimatedCollapse';
import { recheckFinancialCorrection, confirmFinancialCorrection, getFinancialCorrection, inspectFinancialCorrection, previewFinancialCorrection } from '../../api';
import type { FinancialActivity, FinancialCorrectionHistory } from '../../../shared/types/financial-activity';
import type { CorrectionStep, FinancialCorrection, FinancialCorrectionDraft, FinancialCorrectionInspection, FinancialCorrectionPreview } from '../../../shared/types/financial-corrections';
import CorrectionFields from './CorrectionFields';
import KeepActualResult from './KeepActualResult';
import CorrectionPreview, { SnapshotSummary } from './CorrectionPreview';
import { initialDraft, intendedDraft, mayRequestSuccessor, rows, scheduleRule } from './correctionPresentation';
import { createClientId } from '../../lib/clientId';

function draftKey(draft: FinancialCorrectionDraft | null): string {
  return draft ? JSON.stringify({ ...intendedDraft(draft), notes:draft.notes || '', categoryId:draft.categoryId || null }) : '';
}
function recoveryStepLabel(step:CorrectionStep): string {
  if (step.after.ruleActions) {
    const old = rows(scheduleRule(step.before,step.after.ruleActions.scheduleId)?.actions);
    const changed = rows(step.after.ruleActions.actions).filter(action => !old.some(previous => JSON.stringify(previous) === JSON.stringify(action)));
    if (changed.length && changed.every(action => action.op === 'set' && action.field === 'notes')) return 'Schedule note';
    return 'Schedule instructions';
  }
  if (step.after.transactions?.length) return 'Account entries';
  if (step.after.removedScheduleId) return 'Schedule removal';
  if (step.after.removedRuleId) return 'Unused instructions';
  return 'Schedule details';
}

export default function FinancialCorrectionEditor({ activity, onDirty, onChanged, onRepair, registerBack, requestDiscard, onEditing, onHistoryChange }: {
  activity:FinancialActivity; onDirty:(dirty:boolean)=>void; onChanged:()=>void; onRepair:()=>void;
  onEditing:(editing:boolean)=>void;
  onHistoryChange:(correction:FinancialCorrectionHistory)=>void;
  registerBack:(back:(()=>boolean)|null)=>void; requestDiscard:(action:()=>void)=>void;
}) {
  const [inspection,setInspection] = useState<FinancialCorrectionInspection|null>(null);
  const [draft,setDraft] = useState<FinancialCorrectionDraft|null>(null);
  const [baseline,setBaseline] = useState<FinancialCorrectionDraft|null>(null);
  const [preview,setPreview] = useState<FinancialCorrectionPreview|null>(null);
  const [loadedCorrection,setCorrection] = useState<FinancialCorrection|null>(null);
  const [editing,setEditing] = useState(false);
  const [keeping,setKeeping] = useState(false);
  const dirty = editing && draftKey(draft) !== draftKey(baseline);
  const [showInspection,setShowInspection] = useState(false);
  const [showProgress,setShowProgress] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [repairAvailable,setRepairAvailable] = useState(false);
  const [recheckMessage,setRecheckMessage] = useState('');
  const [uncertainConfirm,setUncertainConfirm] = useState(false);
  const surface = useRef<HTMLElement>(null);
  const previousStage = useRef('record');
  const alive = useRef(true);
  const lock = useRef(false);
  const key = useRef(createClientId());
  const admitted = useRef<string|null>(null);
  const remoteId = activity.correction?.id;
  const previousRemoteId = useRef(remoteId);
  const statusId = useRef(remoteId);
  const correction = loadedCorrection?.id === statusId.current && remoteId === previousRemoteId.current ? loadedCorrection : null;
  useEffect(() => {
    if (correction) onHistoryChange({ id:correction.id, predecessorId:correction.preview.predecessorId, state:correction.state,
      updatedAt:correction.updatedAt, resolution:(correction.effectiveResult as {resolution?:'kept_actual'} | null)?.resolution, steps:correction.steps.map(({ state,attemptedAt }) => ({ state,attemptedAt })) });
  },[correction,onHistoryChange]);
  useEffect(() => {
    if (remoteId === previousRemoteId.current) return;
    previousRemoteId.current = remoteId;
    statusId.current = remoteId;
    if (admitted.current !== remoteId) admitted.current = null;
    setCorrection(current => current?.id === remoteId ? current : null);
  },[remoteId]);
  const notified = useRef(activity.correction?.state === 'completed' ? activity.correction.id : '');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirty(dirty); },[dirty,onDirty]);
  useEffect(() => { onEditing(editing || keeping || uncertainConfirm); },[editing,keeping,uncertainConfirm,onEditing]);
  useEffect(() => {
    const stage = keeping ? 'keep' : preview ? 'preview' : editing ? 'edit' : 'record';
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    surface.current?.querySelector<HTMLElement>('[data-correction-focus]')?.focus({ preventScroll:true });
    surface.current?.closest('.financial-detail')?.scrollTo({ top:0 });
  },[editing,preview,keeping]);
  useEffect(() => {
    const discard = () => requestDiscard(() => { setEditing(false); setDraft(null); setPreview(null); onDirty(false); });
    registerBack(busy || uncertainConfirm ? () => true : keeping ? () => {setKeeping(false);return true;} : preview ? () => { setPreview(null); return true; } : editing ? () => { discard(); return true; } : null);
    return () => registerBack(null);
  },[preview,editing,keeping,busy,uncertainConfirm,registerBack,requestDiscard,onDirty]);
  useEffect(() => {
    const id = statusId.current || remoteId;
    if (!id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try { const result = await getFinancialCorrection(id); if (!active) return; setCorrection(result);
        if (result.state === 'completed' && notified.current !== result.id) {
          notified.current = result.id;
          if (admitted.current === result.id) { setEditing(false); setPreview(null); setDraft(null); onDirty(false); }
          onChanged();
        }
        if (['applying','recovering'].includes(result.state)) timer = setTimeout(() => void refresh(),5000);
      } catch (cause) { if (active) { setError(cause instanceof Error ? cause.message : 'Could not refresh correction status.'); timer = setTimeout(() => void refresh(),5000); } }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  },[remoteId,loadedCorrection?.id,onChanged,onDirty]);
  async function inspect(edit:boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setRepairAvailable(false);
    try { const result = await inspectFinancialCorrection(activity.reference); if (!alive.current) return;
      setInspection(result);
      if (!editing) { const next = initialDraft(result,activity); setDraft(next); setBaseline(next); }
      statusId.current = result.correction?.id;
      setCorrection(result.correction);
      if (result.correction?.state === 'completed') notified.current = result.correction.id;
      if (edit && (!result.correction || ['completed','superseded'].includes(result.correction.state) || mayRequestSuccessor(result.correction))) setEditing(true);
    } catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : 'Current Actual details are unavailable. Your draft is retained.'); setRepairAvailable(true); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function recheck() {
    if (!correction || lock.current) return;
    setRecheckMessage('');
    lock.current = true; setBusy(true); setError(''); setRepairAvailable(false);
    try {
      const result = await recheckFinancialCorrection(activity.reference,correction.id);
      if (!alive.current) return;
      setInspection(result); setCorrection(result.correction); setShowInspection(true);
      if (result.correction?.state === 'attention') setRecheckMessage('Checked Actual. The correction still needs attention; its current details are shown below.');
      if (result.correction?.state === 'completed') notified.current = result.correction.id;
      onChanged();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not recheck Actual. The correction remains open.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function prepare() {
    if (!draft || !draft.date || !hasAccounts || lock.current || uncertainConfirm || (correction && !['completed','superseded'].includes(correction.state) && !mayRequestSuccessor(correction))) return;
    lock.current = true; setBusy(true); setError(''); setRepairAvailable(false);
    try { const result = await previewFinancialCorrection(activity.reference,intendedDraft(draft)); if (alive.current) { setPreview(result); key.current = createClientId(); setUncertainConfirm(false); } }
    catch (cause) { if (alive.current) { setPreview(null); setError(cause instanceof Error ? cause.message : 'Could not preview changes. Your draft is retained.'); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function save() {
    if (!preview || lock.current || uncertainConfirm) return;
    lock.current = true; setBusy(true); setError(''); setRepairAvailable(false);
    try { const result = await confirmFinancialCorrection(preview.id,key.current); if (alive.current) { admitted.current = result.id; statusId.current = result.id; setCorrection(result); setEditing(false); setPreview(null); onDirty(false); onChanged(); } }
    catch (cause) {
      if (!alive.current) return;
      const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0;
      if (status === 409 || status === 400) { setPreview(null); setError(`${cause instanceof Error ? cause.message : 'This preview changed.'} Refresh current details, then preview again. Your draft is retained.`); }
      else { setUncertainConfirm(true); setError('The confirmation response was not received. Check correction status before doing anything else. Your intended changes are retained.'); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function checkAdmission() {
    if (!preview || lock.current) return;
    lock.current = true; setBusy(true);
    try { const result = await getFinancialCorrection(preview.id); if (alive.current) { admitted.current = result.id; statusId.current = result.id; setCorrection(result); setEditing(false); setPreview(null); setUncertainConfirm(false); onDirty(false); setError(''); onChanged(); } }
    catch { if (alive.current) setError('A saved correction could not be confirmed yet. Keep this record open or inspect it again later; do not send another correction.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const kept = (correction?.effectiveResult as {resolution?:string}|null)?.resolution === 'kept_actual';
  const marker = correction || activity.correction;
  const blocked = marker && marker.state !== 'completed' && marker.state !== 'superseded';
  const successor = correction && mayRequestSuccessor(correction);
  const canEdit = (!blocked || successor) && (!kept || !!(correction?.effectiveResult as {entry?:unknown}|null)?.entry);
  const stopped = correction?.state === 'attention' && correction.executionStopped;
  const hasAccount = (id:string | undefined) => inspection?.snapshot.accounts.some(account => account.id === id && !account.closed && !account.tombstone);
  const hasAccounts = draft && ((draft.type === 'transfer' || draft.type === 'transfer_schedule')
    ? hasAccount(draft.fromAccountId) && hasAccount(draft.toAccountId) && draft.fromAccountId !== draft.toAccountId
    : hasAccount(draft.accountId));
  const discard = () => requestDiscard(() => { setEditing(false); setDraft(null); setPreview(null); onDirty(false); });
  return <section ref={surface} className="financial-section" aria-label="Correct Actual record">
    <AnimatedHeight><div className="p-1">
      {marker && !correction && <p role="status" className="financial-note">Loading the current correction status…</p>}
      {correction && !editing && !keeping && <div className="financial-status-panel" data-tone={correction.state === 'completed' ? 'success' : 'attention'}>
        <div role="status">
          <h3>{correction.state === 'completed' ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}{correction.state === 'completed' ? kept ? 'Current Actual result kept' : 'Correction saved to Actual' : correction.state === 'attention' ? 'Correction needs attention' : 'Checking correction progress'}</h3>
          <p>{correction.state === 'completed' ? kept ? 'You chose to keep the reviewed result. The original attempt and its history remain available below.' : 'Your changes are saved in Actual. The original receipt remains in Record history.' : successor ? 'Review the remaining work, then preview your next update.' : stopped ? 'Review what is in Actual, then recheck to resolve the correction.' : 'Setpoint is checking what reached Actual. You can close this record and return later.'}</p>
          {stopped && <ul className="financial-recovery-progress">{correction.steps.map(({ step,state }) => <li key={step.id} data-tone={state === 'applied' ? 'success' : 'attention'}>
            {state === 'applied' ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}<span>{recoveryStepLabel(step)}</span><strong>{({ applied:'Saved',no_write:'Not saved',partial:'Partly saved',conflict:'Needs review',uncertain:'Not confirmed',unattempted:'Not saved' })[state]}</strong>
          </li>)}</ul>}
        </div>
        <button type="button" className="financial-disclosure" aria-expanded={showProgress} onClick={() => setShowProgress(value => !value)}><ChevronDown size={14} />Change details</button>
        <AnimatedCollapse open={showProgress}><div className="financial-disclosure-body space-y-2">
          {correction.steps.map((step,index) => <p key={step.step.id}>Change {index + 1}: {({ unattempted:'Waiting', uncertain:'Outcome not yet known', applied:'Applied', no_write:'Confirmed unchanged', partial:'Partially applied', conflict:'Current Actual state conflicts' })[step.state]}{step.error ? step.state === 'partial' ? ' · Some changes were applied.' : step.state === 'conflict' ? ' · Actual no longer matches the last checked result.' : step.state === 'no_write' ? ' · This change was not saved.' : ' · Setpoint is checking what reached Actual.' : ''}</p>)}
          {blocked && !successor && <p>{stopped ? 'Rechecking reads Actual without sending the change again. You can resolve a verified correction, or explicitly review and keep the current result.' : 'A new correction is unavailable until this attempt is resolved. Status updates automatically.'}</p>}
        </div></AnimatedCollapse>
      </div>}
      {error && <div role="alert" className="financial-error"><p>{error}</p>{repairAvailable ? <button type="button" className="financial-button mt-2" onClick={onRepair}>Check Actual connection</button> : editing && !preview && !uncertainConfirm && <button type="button" className="financial-button mt-2" disabled={busy} onClick={() => void inspect(false)}><RefreshCw size={14} />Refresh Actual and keep draft</button>}</div>}
      {!editing && !keeping && !uncertainConfirm && (canEdit || stopped) && <div className="financial-recovery-actions"><div className="financial-actions">
        {canEdit && <button type="button" data-correction-focus className={`financial-button ${activity.status === 'completed' ? 'financial-back' : 'financial-primary'}`} disabled={busy} onClick={() => void inspect(true)}><Pencil size={14} />{busy ? 'Reading Actual…' : successor ? 'Review remaining changes' : 'Correct record'}</button>}
        {stopped && !canEdit && <button type="button" className="financial-button financial-primary" disabled={busy} onClick={() => void recheck()}><RefreshCw size={14} />{busy ? 'Checking Actual…' : 'Recheck and resolve'}</button>}
      </div>{stopped && <div className="financial-recovery-alternatives">
        {canEdit && <div><button type="button" className="financial-disclosure" disabled={busy} onClick={() => void recheck()}><RefreshCw size={14} />Recheck and resolve</button><p>Already fixed it in Actual? Check again without sending changes.</p></div>}
        <div><button type="button" className="financial-disclosure" disabled={busy} onClick={()=>{setError('');setKeeping(true);}}><Check size={14}/>Keep this result</button><p>Review and accept what is in Actual. Leave the remaining changes unapplied.</p></div>
      </div>}</div>}
      {!editing && !keeping && stopped && recheckMessage && <p role="status" className="financial-note">{recheckMessage}</p>}
      {keeping && correction && <KeepActualResult reference={activity.reference} correction={correction} onBusy={setBusy} onBack={()=>setKeeping(false)} onKept={result=>{setCorrection(result);notified.current=result.id;setKeeping(false);setInspection(null);onChanged();}}/>}
      {editing && draft && inspection && !preview && !uncertainConfirm && canEdit && <form className="space-y-4" aria-label="Correction draft" onSubmit={event => { event.preventDefault(); void prepare(); }}>
        <div className="financial-editor-heading"><button type="button" className="financial-button financial-back" disabled={busy} onClick={discard}><ArrowLeft size={14} />Back to record</button><h3 data-correction-focus tabIndex={-1} className="outline-none"><Pencil size={16} />{successor ? 'Finish correction' : 'Edit record'}</h3><p className="financial-note">{successor ? 'Start from the changes already saved. Preview what still needs to change before saving.' : 'Update the details, then preview exactly what will change in Actual.'}</p></div>
        <CorrectionFields draft={draft} inspection={inspection} disabled={busy} onChange={setDraft} />
        <div className="financial-actions"><button type="submit" className="financial-button financial-primary" disabled={busy || !hasAccounts || !draft.date}>{busy ? 'Checking changes…' : 'Preview changes'}<ArrowRight size={14} /></button></div>
      </form>}
      {preview && <div data-correction-focus tabIndex={-1} aria-label="Review changes to Actual" className="space-y-4 outline-none">
        {!uncertainConfirm && <button className="financial-button financial-back" disabled={busy} onClick={() => setPreview(null)}><ArrowLeft size={14} />Back to edit</button>}
        <CorrectionPreview preview={preview} /><div className="financial-actions">
          {uncertainConfirm ? <button className="financial-button financial-primary" disabled={busy} onClick={() => void checkAdmission()}><RefreshCw size={14} />Check correction status</button> : <button className="financial-button financial-primary" disabled={busy || !preview.steps.length} onClick={() => void save()}><Check size={14} />{busy ? 'Saving…' : 'Save to Actual'}</button>}
        </div>
      </div>}
      {!keeping && !preview && !uncertainConfirm && (canEdit || stopped || inspection || kept) && <div className="mt-4">
        <button type="button" className="financial-disclosure" disabled={busy} aria-expanded={showInspection} onClick={() => { setShowInspection(value => !value); if (!showInspection && !inspection) void inspect(false); }}><Eye size={15} />Current Actual details<ChevronDown size={14} /></button>
        <AnimatedCollapse open={showInspection}><div className="financial-disclosure-body">
          {inspection ? <><SnapshotSummary snapshot={inspection.snapshot} transferLabel="Transfer · last read from Actual" /><p className="financial-note">Actual may have changed since this read. Refresh to check its current state.</p>{!(error && editing && !repairAvailable) && <button type="button" className="financial-button mt-3" disabled={busy} onClick={() => void inspect(false)}><RefreshCw size={14} />{busy ? 'Reading Actual…' : 'Refresh from Actual'}</button>}</> : <p role="status" className="financial-note">{busy ? 'Reading current Actual details…' : 'Current details are unavailable.'}</p>}
        </div></AnimatedCollapse>
      </div>}
    </div></AnimatedHeight>
  </section>;
}
