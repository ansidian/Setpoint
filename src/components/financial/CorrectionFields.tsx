import { ArrowDownLeft, ArrowUpRight, Landmark, Wallet } from 'lucide-react';
import Dropdown from '../shared/Dropdown';
import DateField from '../shared/pickers/DateField';
import SearchableDropdown from '../shared/SearchableDropdown';
import type { FinancialCorrectionDraft, FinancialCorrectionInspection } from '../../../shared/types/financial-corrections';
import { nameFor, rows, typeLabels } from './correctionPresentation';

export default function CorrectionFields({ draft, inspection, disabled, onChange }: {
  draft: FinancialCorrectionDraft; inspection: FinancialCorrectionInspection; disabled: boolean;
  onChange: (draft: FinancialCorrectionDraft) => void;
}) {
  const patch = (value: Partial<FinancialCorrectionDraft>) => onChange({ ...draft, ...value });
  const snapshot = inspection.snapshot;
  const accounts = snapshot.accounts.filter(account => !account.closed && !account.tombstone);
  const accountOptions = accounts.map(account => ({ id:account.id,name:String(account.name) }));
  const categoryOptions = [{ id:"",name:"No category" },...snapshot.categories.filter(category => !category.tombstone).map(category => ({ id:category.id,name:String(category.name) }))];
  const schedule = snapshot.schedules.find(row => !row.tombstone);
  const primarySchedule = inspection.evidence.objects.some(object => object.kind === 'schedule' && object.role === 'primary');
  const crossesBudget = [draft.fromAccountId,draft.toAccountId].some(id => accounts.find(account => account.id === id)?.offbudget);
  const scheduleEvidence = inspection.evidence.objects.find(object => object.kind === 'schedule' && object.id === schedule?.id);
  const ruleEvidence = inspection.evidence.objects.find(object => object.kind === 'rule' && object.id === schedule?.rule);
  const dateEvidence = inspection.evidence.objects.find(object => object.kind === 'schedule_next_date' && object.before?.schedule_id === schedule?.id);
  const missingBefore = scheduleEvidence?.beforeState !== 'captured';
  const canRestore = !missingBefore && ruleEvidence?.beforeState === 'captured' && dateEvidence?.beforeState === 'captured'
    && typeof rows(ruleEvidence.before?.conditions).find(condition => condition.field === 'date')?.value === 'string';
  const paired = snapshot.transactions.filter(row => row.transferred_id && !row.tombstone);
  return <fieldset disabled={disabled} className="space-y-4">
    <div className="financial-field"><span>Record type</span><Dropdown ariaLabel="Record type" value={draft.type} disabled={disabled} onChange={type => patch({ type:type as FinancialCorrectionDraft['type'] })} options={Object.entries(typeLabels).map(([id,name]) => ({ id,name }))} /></div>
    <div className="financial-fields">
      <label className="financial-field"><span className="financial-field-label"><Wallet size={13} aria-hidden="true" />{draft.type === 'transfer' ? 'Transfer' : draft.type === 'income' ? 'Inflow' : 'Outflow'} amount (USD)</span><input type="number" min="0.01" step="0.01" required value={draft.amountCents ? draft.amountCents / 100 : ''} onChange={event => patch({ amountCents:Math.round(Number(event.target.value) * 100) })} /></label>
      <div className="financial-field"><span>{draft.type === 'bill' ? 'Due date' : 'Date'}</span><DateField ariaLabel={draft.type === 'bill' ? 'Due date' : 'Date'} value={draft.date} disabled={disabled} onChange={date => patch({ date })} /></div>
      {draft.type === 'transfer' ? <>
        <div className="financial-field financial-transfer-field"><span className="financial-field-label"><ArrowUpRight size={13} aria-hidden="true" />From account</span><SearchableDropdown ariaLabel="From account" options={accountOptions} value={draft.fromAccountId} disabled={disabled} onChange={fromAccountId => patch({ fromAccountId })} placeholder="Choose an account" /></div>
        <div className="financial-field financial-transfer-field"><span className="financial-field-label"><ArrowDownLeft size={13} aria-hidden="true" />To account</span><SearchableDropdown ariaLabel="To account" options={accountOptions} value={draft.toAccountId} disabled={disabled} onChange={toAccountId => patch({ toAccountId })} placeholder="Choose an account" /></div>
      </> : <>
        <div className="financial-field"><span>Payee</span><SearchableDropdown ariaLabel="Payee" options={[{ id:"",name:"No payee" },...snapshot.payees.filter(payee => !payee.transfer_acct && !payee.tombstone).map(payee => ({ id:payee.id,name:String(payee.name) }))]} value={draft.payeeId || ""} disabled={disabled} onChange={payeeId => patch({ payeeId:payeeId || null })} placeholder="No payee" /></div>
        <div className="financial-field"><span className="financial-field-label"><Landmark size={13} aria-hidden="true" />Account</span><SearchableDropdown ariaLabel="Account" options={accountOptions} value={draft.accountId} disabled={disabled} onChange={accountId => patch({ accountId })} placeholder="Choose an account" /></div>
        <div className="financial-field"><span>Category (optional)</span><SearchableDropdown ariaLabel="Category (optional)" options={categoryOptions} value={draft.categoryId || ""} disabled={disabled} onChange={categoryId => patch({ categoryId:categoryId || null })} placeholder="No category" /></div>
      </>}
      {draft.type === 'bill' && <label className="financial-field">Schedule name<input maxLength={2000} value={draft.name || ''} onChange={event => patch({ name:event.target.value })} /></label>}
    </div>
    <p className="financial-note">Enter a positive amount. {draft.type === 'transfer' ? 'Money moves from the From account to the To account.' : draft.type === 'income' ? 'This adds money to the selected account.' : 'This takes money out of the selected account; no minus sign needed.'}</p>
    {draft.type === 'transfer' && crossesBudget && <div className="financial-field"><span>Category (optional)</span><SearchableDropdown ariaLabel="Category (optional)" options={categoryOptions} value={draft.categoryId || ""} disabled={disabled} onChange={categoryId => patch({ categoryId:categoryId || null })} placeholder="No category" /><span className="financial-note">Applies to the account included in your budget.</span></div>}
    {draft.type === 'transfer' && draft.fromAccountId && draft.fromAccountId === draft.toAccountId && <p role="status" className="financial-error">Choose different From and To accounts.</p>}
    {draft.type === 'bill' && <><div className="financial-field"><span>Schedule</span><SearchableDropdown ariaLabel="Schedule" options={[{ id:"",name:primarySchedule ? "Keep the original schedule" : "Create a one-time schedule" },...snapshot.scheduleNames.map(row => ({ id:row.id,name:String(row.name) }))]} value={draft.targetScheduleId || ""} disabled={disabled} onChange={targetScheduleId => patch({ targetScheduleId:targetScheduleId || undefined })} /></div><p className="financial-note">The due date updates the selected occurrence. Existing recurrence stays in place. The preview checks whether this date and linked history can be changed safely.</p></>}
    {schedule && draft.type !== 'bill' && <div className="space-y-3">
      <p className="financial-note">{missingBefore ? 'The original schedule snapshot was not saved. Choose how to treat the current schedule.' : 'Choose what happens to the existing schedule.'} Keeping it preserves future occurrences; retiring removes it only when supported. Exact restoration requires a saved, unchanged one-time occurrence.</p>
      <div className="financial-field"><span>Existing schedule treatment</span><Dropdown ariaLabel="Existing schedule treatment" required disabled={disabled} placeholder="Choose a treatment" value={draft.scheduleTreatment || null} onChange={scheduleTreatment => patch({ scheduleTreatment:scheduleTreatment as FinancialCorrectionDraft['scheduleTreatment'] })} options={[{ id:"keep",name:"Keep current schedule" },{ id:"retire",name:"Retire eligible schedule" },...(canRestore ? [{ id:"restore",name:"Restore saved one-time occurrence" }] : [])]} /></div>
    </div>}
    {paired.length > 0 && draft.type !== 'transfer' && draft.type !== 'bill' && <div className="financial-field"><span>Keep this side of the transfer</span><Dropdown ariaLabel="Keep this side of the transfer" required disabled={disabled} placeholder="Choose the entry to retain" value={draft.retainTransactionId || null} onChange={retainTransactionId => patch({ retainTransactionId })} options={paired.map(row => ({ id:row.id,name:nameFor(snapshot.accounts,row.acct) }))} /></div>}
    <label className="financial-field">Notes (optional)<textarea rows={2} maxLength={1000} value={draft.notes || ''} onChange={event => patch({ notes:event.target.value })} /></label>
  </fieldset>;
}
