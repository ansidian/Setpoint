import { useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, ChevronDown, Link2, ListChecks } from 'lucide-react';
import AnimatedCollapse from '../shared/AnimatedCollapse';
import type { CorrectionRow, CorrectionSnapshot, FinancialCorrectionPreview } from '../../../shared/types/financial-corrections';
import { afterStep, dateLabel, money, nameFor, nextOccurrence, normalizedField, record, rows, scheduleRule, typeLabels } from './correctionPresentation';

const fields = ['acct','description','amount','date','category','notes','cleared','reconciled','schedule','transferred_id','tombstone'] as const;
const labels: Record<string,string> = { acct:'Account', account:'Account', description:'Payee', payee:'Payee', amount:'Amount', date:'Date', category:'Category', notes:'Notes', cleared:'Cleared', reconciled:'Reconciled', schedule:'Linked schedule', transferred_id:'Paired transfer', tombstone:'Entry', name:'Name', posts_transaction:'Automatic posting', completed:'Completed', active:'Active' };
function recurrence(value: Record<string,unknown>): string {
  const frequency = String(value.frequency || 'Existing recurrence').replace(/_/g,' ');
  const interval = Number(value.interval || 1);
  return `${interval > 1 ? `Every ${interval} · ` : ''}${frequency}${value.start ? ` from ${dateLabel(value.start)}` : ''}${value.end ? ` until ${dateLabel(value.end)}` : ''}${value.skipWeekend ? ' · moves weekend occurrences' : ''}`;
}
function displayValue(field: string, value: unknown, snapshot: CorrectionSnapshot): string {
  if (value && typeof value === 'object') return field === 'date' ? recurrence(record(value)) : 'Existing rule value';
  if (field === 'amount') return money(value);
  if (field === 'date') return dateLabel(value) || 'None';
  if (field === 'acct' || field === 'account') return nameFor(snapshot.accounts,value);
  if (field === 'description' || field === 'payee') return nameFor(snapshot.payees,value);
  if (field === 'category') return nameFor(snapshot.categories,value);
  if (field === 'schedule') return nameFor(snapshot.scheduleNames,value);
  if (field === 'transferred_id') return value ? 'Linked to other account' : 'No paired entry';
  if (field === 'tombstone') return value ? 'Removed' : 'Retained';
  if (['cleared','reconciled','posts_transaction','completed','active'].includes(field)) return value ? 'Yes' : 'No';
  return value == null || value === '' ? 'None' : String(value);
}
function actionLabel(action: Record<string,unknown>, snapshot: CorrectionSnapshot): string {
  if (action.op === 'link-schedule') return 'Link the entry to this schedule';
  const field = normalizedField(action.field);
  const label = labels[field] || field.replace(/_/g,' ');
  const options = record(action.options);
  if (action.op === 'set') return `${label}: ${options.formula ? `calculated (${String(action.value)})` : options.template ? `template (${String(action.value)})` : displayValue(field,action.value,snapshot)}`;
  return `${String(action.op || 'Existing instruction').replace(/-/g,' ')} ${label}: ${displayValue(field,action.value,snapshot)}`;
}
function ActionChanges({ before, after, snapshot }: { before: unknown; after: unknown; snapshot:CorrectionSnapshot }) {
  const old = rows(before), next = rows(after);
  return <table className="financial-table"><thead><tr><th>Instructions before</th><th>Instructions after</th></tr></thead><tbody>
    {Array.from({ length:Math.max(old.length,next.length,1) },(_,index) => <tr key={index}><td>{old[index] ? actionLabel(old[index],snapshot) : 'None'}</td><td>{next[index] ? actionLabel(next[index],snapshot) : 'None'}</td></tr>)}
  </tbody></table>;
}
function isTransferPair(first?:CorrectionRow, second?:CorrectionRow): boolean {
  return !!first && !!second && !first.tombstone && !second.tombstone
    && typeof first.amount === 'number' && Number.isFinite(first.amount) && first.amount < 0
    && typeof second.amount === 'number' && first.amount === -second.amount
    && first.transferred_id === second.id && second.transferred_id === first.id;
}
export function SnapshotSummary({ snapshot, transferLabel = 'Saved transfer' }: { snapshot: CorrectionSnapshot; transferLabel?:string }) {
  const transactions = snapshot.transactions.filter(row => !row.tombstone);
  return <>
    {transactions.map(row => {
      const paired = transactions.find(other => other.id === row.transferred_id);
      if (isTransferPair(paired,row)) return null;
      if (isTransferPair(row,paired)) return <section className="financial-transfer-snapshot" aria-label={transferLabel} key={row.id}>
        <h4>{transferLabel}</h4><TransferChanges entries={[row,paired!]} snapshot={snapshot} />
      </section>;
      return <dl className="financial-summary" key={row.id}>{['acct','description','amount','date','category','notes'].map(field => <div key={field}><dt>{labels[field]}</dt><dd>{displayValue(field,row[field],snapshot)}</dd></div>)}</dl>;
    })}
    {snapshot.schedules.filter(row => !row.tombstone).map(schedule => {
      const actions = rows(scheduleRule(snapshot,schedule.id)?.actions);
      return <section key={schedule.id} className="financial-snapshot-schedule" aria-label={String(schedule.name || nameFor(snapshot.scheduleNames,schedule.id))}>
        <h4><CalendarDays size={16} aria-hidden="true" />{String(schedule.name || nameFor(snapshot.scheduleNames,schedule.id))}</h4>
        <dl className="financial-summary">
          {rows(scheduleRule(snapshot,schedule.id)?.conditions).map((condition,index) => <div key={index}><dt>{labels[String(condition.field)] || String(condition.field).replace(/_/g,' ')}</dt><dd>{displayValue(normalizedField(condition.field),condition.value,snapshot)}</dd></div>)}
          <div><dt>Next occurrence</dt><dd>{dateLabel(nextOccurrence(snapshot,schedule.id)) || 'Not available'}</dd></div>
          <div><dt className="financial-evidence-label"><Link2 size={13} aria-hidden="true" />Linked entries</dt><dd>{snapshot.transactions.filter(row => !row.tombstone && row.schedule === schedule.id).length}<span className="financial-summary-context">In this snapshot</span></dd></div>
        </dl>
        {actions.length > 0 && <div className="financial-snapshot-instructions"><h5><ListChecks size={15} aria-hidden="true" />Schedule instructions</h5><ul>{actions.map((action,index) => <li key={index}>{actionLabel(action,snapshot)}</li>)}</ul></div>}
      </section>;
    })}
  </>;
}
function TransactionChanges({ before, after, snapshot }: { before?: CorrectionRow; after:CorrectionRow; snapshot:CorrectionSnapshot }) {
  const effectiveAfter = before ? { ...before,...after } : after;
  const changed = fields.filter(field => !before ? after[field] !== undefined : JSON.stringify(before[field] ?? null) !== JSON.stringify(effectiveAfter[field] ?? null));
  return <div className="mt-3"><h4 className="mb-2 font-medium">{before ? after.tombstone ? 'Remove entry' : 'Update entry · keep its identity' : 'Create entry'} · {nameFor(snapshot.accounts,effectiveAfter.acct)}</h4>
    {!!after.tombstone && before && <p className="financial-note">Remove the {money(before.amount)} entry dated {dateLabel(before.date)}. Its original receipt remains in Setpoint.</p>}
    <table className="financial-table"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{changed.map(field => <tr key={field}><th scope="row">{labels[field]}</th><td>{before ? displayValue(field,before[field],snapshot) : 'No entry'}</td><td>{displayValue(field,effectiveAfter[field],snapshot)}</td></tr>)}</tbody></table>
    {before && !after.tombstone && <p className="financial-note mt-2">Other saved fields and import identity are retained unless shown above.</p>}
  </div>;
}
function AmountDiff({ before, after }: { before?:unknown; after:unknown }) {
  const amount = (value:unknown) => `${Number(value) > 0 ? '+' : ''}${money(value)}`;
  return <div className="financial-amount-diff">
    {before !== undefined && before !== after && <><span className="sr-only">Before </span><del>{amount(before)}</del><ArrowRight size={16} aria-hidden="true" /><span className="sr-only">After </span></>}
    <strong>{amount(after)}</strong>
  </div>;
}
function PaymentChanges({ before, after, snapshot }: { before?:CorrectionRow; after:CorrectionRow; snapshot:CorrectionSnapshot }) {
  const incoming = Number(after.amount) > 0;
  const changed = fields.filter(field => !['acct','amount'].includes(field)
    && (!before ? after[field] != null && after[field] !== '' : displayValue(field,before[field],snapshot) !== displayValue(field,after[field],snapshot)));
  return <div className="financial-confirmation-flow financial-payment-change" data-direction={incoming ? 'inflow' : 'outflow'} aria-label="Transaction changes">
    <div className="financial-confirmation-direction">{incoming ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}{incoming ? 'Money in' : 'Money out'}</div>
    <AmountDiff before={before?.amount} after={after.amount} />
    <p>{incoming ? 'Into' : 'From'} <strong>{nameFor(snapshot.accounts,after.acct)}</strong></p>
    {before && before.acct !== after.acct && <p className="financial-transfer-previous">Previously {nameFor(snapshot.accounts,before.acct)}</p>}
    {!before && <p className="financial-transfer-previous">New entry</p>}
    {changed.length > 0 && <dl>{changed.map(field => <div key={field}><dt>{labels[field]}</dt><dd>
      {before && <><span className="sr-only">Before </span><del>{displayValue(field,before[field],snapshot)}</del><ArrowRight size={12} aria-hidden="true" /><span className="sr-only">After </span></>}
      <span>{displayValue(field,after[field],snapshot)}</span>
    </dd></div>)}</dl>}
  </div>;
}
function TransferChanges({ entries, before, snapshot }: { entries:CorrectionRow[]; before?:CorrectionSnapshot; snapshot:CorrectionSnapshot }) {
  return <div className="financial-transfer-flow" aria-label={before ? 'Transfer changes' : 'Money flow'}>
    {entries.map((entry,index) => {
      const previous = before?.transactions.find(row => row.id === entry.id && !row.tombstone);
      const changed = fields.filter(field => !['acct','amount'].includes(field)
        && (before ? displayValue(field,previous?.[field],snapshot) !== displayValue(field,entry[field],snapshot)
          : ['date','category','notes'].includes(field) && entry[field] != null && entry[field] !== ''));
      return <div className="financial-transfer-account" data-direction={index === 0 ? 'out' : 'in'} key={entry.id}>
        {index === 1 && <ArrowRight className="financial-transfer-arrow" size={20} aria-hidden="true" />}
        <div className="financial-transfer-direction">{index === 0 ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowDownLeft size={16} aria-hidden="true" />}{index === 0 ? 'From' : 'To'}</div>
        <h4>{nameFor(snapshot.accounts,entry.acct)}</h4>
        {previous && previous.acct !== entry.acct && <p className="financial-transfer-previous">Previously {nameFor(snapshot.accounts,previous.acct)}</p>}
        <AmountDiff before={previous?.amount} after={entry.amount} />
        {before && !previous && <p className="financial-transfer-previous">New entry</p>}
        {changed.length > 0 && <dl className="financial-transfer-details">{changed.map(field => <div key={field}>
          <dt>{labels[field]}</dt><dd>{previous && <><span className="sr-only">Before </span><span>{displayValue(field,previous[field],snapshot)}</span><ArrowRight size={12} aria-hidden="true" /><span className="sr-only">After </span></>}{displayValue(field,entry[field],snapshot)}</dd>
        </div>)}</dl>}
      </div>;
    })}
  </div>;
}
type PreviewStage = { step:FinancialCorrectionPreview['steps'][number]; before:CorrectionSnapshot; after:CorrectionSnapshot };
function ScheduleChangeSummary({ stages }: { stages:PreviewStage[] }) {
  const changes:Array<{ title:string; before?:string; after?:string; amount?:{ before?:number; after:number; account:string } }> = [];
  for (const { step,before,after } of stages) {
    const id = step.after.schedule?.id || step.after.ruleActions?.scheduleId;
    const previous = before.schedules.find(row => row.id === id && !row.tombstone);
    const rule = id ? scheduleRule(before,id) : undefined;
    const snapshot = { ...after,scheduleNames:after.schedules };
    if (step.after.schedule && !previous) changes.push({ title:'Create schedule',after:String(step.after.schedule.name || 'New schedule') });
    for (const field of ['name','posts_transaction','completed','active']) {
      const value = step.after.schedule?.[field];
      if (value !== undefined && value !== previous?.[field]) changes.push({ title:labels[field]!,before:previous ? displayValue(field,previous[field],snapshot) : undefined,after:displayValue(field,value,snapshot) });
    }
    if (step.after.conditions) {
      const old = rows(rule?.conditions), next = rows(step.after.conditions);
      for (const field of new Set([...old,...next].map(condition => normalizedField(condition.field)))) {
        const oldValues = old.filter(condition => normalizedField(condition.field) === field);
        const newValues = next.filter(condition => normalizedField(condition.field) === field);
        if (JSON.stringify(oldValues) === JSON.stringify(newValues)) continue;
        const describe = (values:Record<string,unknown>[]) => values.map(condition => `${condition.op && condition.op !== 'is' ? `${String(condition.op).replace(/-/g,' ')} ` : ''}${displayValue(field,condition.value,snapshot)}`).join('; ') || 'None';
        const amount = field === 'amount' && newValues.length === 1 && typeof newValues[0]?.value === 'number' && Number.isFinite(newValues[0].value)
          && (!newValues[0].op || newValues[0].op === 'is') && oldValues.length <= 1
          && (!oldValues.length || typeof oldValues[0]?.value === 'number' && Number.isFinite(oldValues[0].value) && (!oldValues[0].op || oldValues[0].op === 'is'))
          ? { before:oldValues[0]?.value as number|undefined,after:newValues[0].value,account:nameFor(snapshot.accounts,next.find(condition => normalizedField(condition.field) === 'account')?.value) } : undefined;
        changes.push({ title:labels[field] || field,before:oldValues.length ? describe(oldValues) : undefined,after:describe(newValues),amount });
      }
    }
    if (step.after.nextDate !== undefined && dateLabel(step.after.nextDate) !== dateLabel(id ? nextOccurrence(before,id) : undefined)) {
      changes.push({ title:'Next occurrence',before:id ? dateLabel(nextOccurrence(before,id)) || 'None' : undefined,after:dateLabel(step.after.nextDate) });
    }
    const actions = step.after.ruleActions?.actions || step.after.scheduleActions;
    if (actions) {
      const removed = [...rows(rule?.actions)], added:Record<string,unknown>[] = [];
      for (const action of rows(actions)) {
        const index = removed.findIndex(old => JSON.stringify(old) === JSON.stringify(action));
        if (index < 0) added.push(action); else removed.splice(index,1);
      }
      for (const action of added) {
        const index = removed.findIndex(old => old.op === action.op && old.field === action.field);
        const old = index < 0 ? undefined : removed.splice(index,1)[0];
        const note = action.op === 'set' && action.field === 'notes' && !Object.keys(record(action.options)).length;
        changes.push({ title:note ? old ? 'Update note' : 'Add note' : old ? 'Update instruction' : 'Add instruction',
          before:old ? note ? displayValue('notes',old.value,snapshot) : actionLabel(old,snapshot) : undefined,
          after:note ? displayValue('notes',action.value,snapshot) : actionLabel(action,snapshot) });
      }
      for (const action of removed) changes.push({ title:action.op === 'set' && action.field === 'notes' ? 'Remove note' : 'Remove instruction',before:actionLabel(action,snapshot) });
    }
    if (step.after.removedScheduleId) changes.push({ title:'Retire schedule',before:nameFor(before.scheduleNames,step.after.removedScheduleId) });
    if (step.after.removedRuleId) changes.push({ title:'Remove unused schedule instructions',after:'The leftover instructions will be removed.' });
  }
  return <div className="financial-schedule-changes" aria-label="Schedule changes">
    {changes.length ? <ul>{changes.map((change,index) => <li key={index} className={change.amount ? 'financial-confirmation-flow financial-payment-change' : 'financial-change-summary'} data-direction={change.amount && change.amount.after > 0 ? 'inflow' : 'outflow'}>
      {change.amount ? <>
        <div className="financial-confirmation-direction">{change.amount.after > 0 ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}{change.amount.after > 0 ? 'Money in' : 'Money out'} · scheduled</div>
        <AmountDiff before={change.amount.before} after={change.amount.after} />
        <p>{change.amount.after > 0 ? 'Into' : 'From'} <strong>{change.amount.account}</strong></p>
      </> : <><strong>{change.title}</strong><div>{change.before && <><span className="sr-only">Before </span><del>{change.before}</del></>}{change.before && change.after && <ArrowRight size={14} aria-hidden="true" />}{change.after && <><span className="sr-only">After </span><span>{change.after}</span></>}</div></>}
    </li>)}</ul> : <p>The schedule details stay the same.</p>}
  </div>;
}
export default function CorrectionPreview({ preview }: { preview:FinancialCorrectionPreview }) {
  const stages = preview.steps.reduce<Array<{ step:FinancialCorrectionPreview['steps'][number]; before:CorrectionSnapshot; after:CorrectionSnapshot }>>((stages,step) => {
    const before = stages[stages.length - 1]?.after || preview.snapshot;
    return [...stages,{ step,before,after:afterStep(before,step) }];
  },[]);
  const [showDetails,setShowDetails] = useState(false);
  const scheduleOnly = preview.steps.length > 0 && preview.steps.every(step => !step.after.transactions?.length);
  const paymentOnly = ['payment','income'].includes(preview.draft.type) && stages.length > 0 && stages.every(({step,after}) =>
    step.command === 'transactions-batch-update' && !!step.after.transactions?.length && step.after.transactions.every(patch => {
      const entry = after.transactions.find(row => row.id === patch.id);
      return entry && !entry.tombstone && !entry.transferred_id && typeof entry.amount === 'number' && Number.isFinite(entry.amount);
    }));
  const details = stages.map(({ step,before,after },index) => {
      const scheduleId = step.after.schedule?.id || step.after.ruleActions?.scheduleId;
      const oldSchedule = before.schedules.find(row => row.id === scheduleId && !row.tombstone);
      const oldRule = scheduleRule(before,scheduleId);
      const oldConditions = rows(oldRule?.conditions);
      const conditions = rows(step.after.conditions);
      const conditionFields = [...new Set([...oldConditions,...conditions].map(condition => normalizedField(condition.field)))];
      const scheduleFields = ['name','posts_transaction','completed','active'].filter(field => step.after.schedule?.[field] !== undefined && (!oldSchedule || oldSchedule[field] !== step.after.schedule[field]));
      const incomingTransfer = Number(conditions.find(condition => normalizedField(condition.field) === 'amount')?.value) > 0;
      const conditionLabel = (field:string) => preview.draft.type === 'transfer_schedule' && (field === 'account' || field === 'payee')
        ? (field === 'account') === incomingTransfer ? 'To account' : 'From account' : labels[field] || field.replace(/_/g,' ');

      const snapshot = { ...preview.snapshot, scheduleNames:[...preview.snapshot.scheduleNames,...after.schedules.filter(row => !preview.snapshot.scheduleNames.some(name => name.id === row.id))] };
      const transferEntries = (step.after.transactions || []).map(entry => after.transactions.find(row => row.id === entry.id)!)
        .sort((left,right) => Number(left.amount) - Number(right.amount));
      const [fromEntry,toEntry] = transferEntries;
      const pairedTransfer = preview.draft.type === 'transfer' && transferEntries.length === 2
        && transferEntries.every(entry => !entry.tombstone && typeof entry.amount === 'number' && Number.isFinite(entry.amount))
        && fromEntry && toEntry && Number(fromEntry.amount) < 0 && Number(fromEntry.amount) === -Number(toEntry.amount)
        && fromEntry.transferred_id === toEntry.id && toEntry.transferred_id === fromEntry.id;
      return <div className="financial-section" key={step.id}>
        {!pairedTransfer && <h3>Change {index + 1} · {step.command === 'transactions-batch-update' ? 'Actual entries' : step.command === 'schedule/create' ? 'Create schedule' : step.command === 'schedule/delete' ? 'Retire schedule' : step.command === 'rule-delete' ? 'Remove unused schedule instructions' : 'Update schedule'}</h3>}
        {pairedTransfer ? <TransferChanges entries={transferEntries} before={before} snapshot={snapshot} />
          : step.after.transactions?.map(entry => <TransactionChanges key={entry.id} before={before.transactions.find(row => row.id === entry.id && !row.tombstone)} after={entry} snapshot={snapshot} />)}
        {step.after.schedule && scheduleFields.length > 0 && <table className="financial-table"><thead><tr><th>Schedule</th><th>Before</th><th>After</th></tr></thead><tbody>
          {scheduleFields.map(field => <tr key={field}><th>{labels[field]}</th><td>{oldSchedule ? displayValue(field,oldSchedule[field],snapshot) : 'No schedule'}</td><td>{displayValue(field,step.after.schedule![field],snapshot)}</td></tr>)}
        </tbody></table>}
        {step.after.conditions && <table className="financial-table"><thead><tr><th>Schedule field</th><th>Before</th><th>After</th></tr></thead><tbody>{conditionFields.map(field => {
          const previous = oldConditions.filter(condition => normalizedField(condition.field) === field);
          const next = conditions.filter(condition => normalizedField(condition.field) === field);
          const describe = (items:Record<string,unknown>[]) => items.map(condition => `${condition.op && condition.op !== 'is' ? `${String(condition.op).replace(/-/g,' ')} ` : ''}${displayValue(field,condition.value,snapshot)}`).join('; ') || 'None';
          return <tr key={field}><th>{conditionLabel(field)}</th><td>{describe(previous)}</td><td>{describe(next)}</td></tr>;
        })}</tbody></table>}
        {step.after.nextDate !== undefined && <p>Next occurrence: {scheduleId ? dateLabel(nextOccurrence(before,scheduleId)) || 'None' : 'None'} → {dateLabel(step.after.nextDate)}</p>}
        {step.after.removedScheduleId && <p>Remove {nameFor(snapshot.scheduleNames,step.after.removedScheduleId)} and its supported occurrence. Existing linked history is checked before saving.</p>}
        {step.after.removedRuleId && <p>Remove the unused instructions left by the earlier incomplete schedule. Its references are checked again before removal.</p>}
        {(step.after.ruleActions || step.after.scheduleActions) && <ActionChanges before={oldRule?.actions} after={step.after.ruleActions?.actions || step.after.scheduleActions} snapshot={snapshot} />}
      </div>;
    });
  return <section aria-label="Exact correction preview" className="space-y-4">
    <h3 className="text-base font-semibold">Review changes to Actual</h3>
    <p>{typeLabels[preview.draft.type]} · {money(preview.draft.amountCents)} · {preview.draft.date}</p>
    {preview.predecessorId && <p className="financial-note">Continuing from the changes already saved in Actual.</p>}
    {scheduleOnly || paymentOnly ? <>
      {scheduleOnly ? <ScheduleChangeSummary stages={stages} /> : stages.map(({step,before,after}) => step.after.transactions?.map(patch =>
        <PaymentChanges key={`${step.id}:${patch.id}`} before={before.transactions.find(row => row.id === patch.id && !row.tombstone)} after={after.transactions.find(row => row.id === patch.id)!} snapshot={after} />))}
      <button type="button" className="financial-disclosure" aria-expanded={showDetails} onClick={() => setShowDetails(value => !value)}><ChevronDown size={14} aria-hidden="true" />Technical details</button>
      <AnimatedCollapse open={showDetails}><div className="financial-disclosure-body">{details}</div></AnimatedCollapse>
    </> : details}
    {!preview.steps.length && <p>No changes are needed.</p>}
    <p className="financial-note">Actual and the source are checked again when you save. If either changed, this preview will not authorize different changes.</p>
  </section>;
}
