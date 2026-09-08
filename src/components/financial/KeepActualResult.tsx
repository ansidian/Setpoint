import { useEffect, useState } from 'react';
import { ArrowLeft, Check, RefreshCw } from 'lucide-react';
import type { FinancialActivityReference } from '../../../shared/types/financial-activity';
import type { CorrectionSnapshot, FinancialCorrection, FinancialCorrectionKeepPreview } from '../../../shared/types/financial-corrections';
import { previewKeepFinancialResult, confirmKeepFinancialResult } from '../../api';
import { SnapshotSummary } from './CorrectionPreview';
import { money, typeLabels } from './correctionPresentation';

export function ActualResultSnapshot({snapshot,transferLabel = 'Saved transfer'}:{snapshot:CorrectionSnapshot;transferLabel?:string}) {
  const active = [...snapshot.transactions,...snapshot.schedules].filter(row=>!row.tombstone);
  const detached = snapshot.rules.filter(rule=>!rule.tombstone && !snapshot.schedules.some(row=>!row.tombstone && row.rule===rule.id));
  return <>
    <SnapshotSummary snapshot={snapshot} transferLabel={transferLabel} />
    {!active.length && <p className="financial-note">No active transactions or schedules remain in this result.</p>}
    {detached.length > 0 && <p className="financial-note">{detached.length} unattached schedule instruction set{detached.length===1?'':'s'} remain in Actual. Keeping this result leaves them in place.</p>}
    {[...snapshot.transactions,...snapshot.schedules].filter(row=>row.tombstone).length > 0 && <p className="financial-note">Removed entries stay removed.</p>}
  </>;
}

export default function KeepActualResult({reference,correction,onBack,onKept,onBusy}:{
  reference:FinancialActivityReference; correction:FinancialCorrection; onBack:()=>void; onKept:(result:FinancialCorrection)=>void; onBusy:(busy:boolean)=>void;
}) {
  const [preview,setPreview] = useState<FinancialCorrectionKeepPreview|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0);
  useEffect(()=>{
    let active=true;
    setBusy(true);onBusy(true);setError('');setPreview(null);
    void previewKeepFinancialResult(reference,correction.id).then(result=>{if(active)setPreview(result);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Could not read Actual. Try again.');}).finally(()=>{if(active){setBusy(false);onBusy(false);}});
    return ()=>{active=false;onBusy(false);};
  },[reference,correction.id,revision,onBusy]);
  async function keep() {
    if (!preview || busy) return;
    setBusy(true);onBusy(true);setError('');
    try { onKept(await confirmKeepFinancialResult(preview.id)); }
    catch(cause) {
      const stale = cause && typeof cause==='object' && 'status' in cause && Number(cause.status)===409;
      if(stale)setPreview(null);
      setError(cause instanceof Error?cause.message:'The response was not received. Try again to check this same confirmation.');
    } finally {setBusy(false);onBusy(false);}
  }
  return <section className="space-y-4" aria-label="Review current Actual result">
    <button type="button" className="financial-button financial-back" disabled={busy} onClick={onBack}><ArrowLeft size={14}/>Back to record</button>
    <h3 data-correction-focus tabIndex={-1} className="outline-none">Keep the current Actual result?</h3>
    <p className="financial-note">This resolves the correction using the result below. Remaining changes will not be applied. The original attempt and its history stay available.</p>
    <p className="financial-note">Requested correction: {typeLabels[correction.preview.draft.type]} · {money(correction.preview.draft.amountCents)} · {correction.preview.draft.date}</p>
    {error && <p role="alert" className="financial-error">{error}</p>}
    {preview ? <>
      <h4>Current result in Actual</h4>
      <ActualResultSnapshot snapshot={preview.snapshot} transferLabel="Transfer · current Actual result"/>
      <p className="financial-note">Actual is checked again when you confirm. This action does not change entries in Actual.</p>
      <button type="button" className="financial-button financial-primary" disabled={busy} onClick={()=>void keep()}><Check size={14}/>{busy?'Checking result…':'Keep this result'}</button>
    </> : busy ? <p role="status" className="financial-note">Reading the current result from Actual…</p> : <button type="button" className="financial-button" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={14}/>Read current result</button>}
  </section>;
}
