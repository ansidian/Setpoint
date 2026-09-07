import { CalendarDays, Link2, ListChecks } from 'lucide-react';
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
export function SnapshotSummary({ snapshot }: { snapshot: CorrectionSnapshot }) {
  return <>
    {snapshot.transactions.filter(row => !row.tombstone).map(row => <dl className="financial-summary" key={row.id}>{['acct','description','amount','date','category','notes'].map(field => <div key={field}><dt>{labels[field]}</dt><dd>{displayValue(field,row[field],snapshot)}</dd></div>)}</dl>)}
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
export default function CorrectionPreview({ preview }: { preview:FinancialCorrectionPreview }) {
  const stages = preview.steps.reduce<Array<{ step:FinancialCorrectionPreview['steps'][number]; before:CorrectionSnapshot; after:CorrectionSnapshot }>>((stages,step) => {
    const before = stages[stages.length - 1]?.after || preview.snapshot;
    return [...stages,{ step,before,after:afterStep(before,step) }];
  },[]);
  return <section aria-label="Exact correction preview" className="space-y-4">
    <h3 className="text-base font-semibold">Review changes to Actual</h3>
    <p>{typeLabels[preview.draft.type]} · {money(preview.draft.amountCents)} · {preview.draft.date}</p>
    {preview.predecessorId && <p className="financial-note">This preview starts from the current result of the earlier correction. Previously applied effects remain unless a change below explicitly updates them.</p>}
    {stages.map(({ step,before,after },index) => {
      const scheduleId = step.after.schedule?.id || step.after.ruleActions?.scheduleId;
      const oldSchedule = before.schedules.find(row => row.id === scheduleId && !row.tombstone);
      const oldRule = scheduleRule(before,scheduleId);
      const oldConditions = rows(oldRule?.conditions);
      const conditions = rows(step.after.conditions);
      const conditionFields = [...new Set([...oldConditions,...conditions].map(condition => normalizedField(condition.field)))];
      const snapshot = { ...preview.snapshot, scheduleNames:[...preview.snapshot.scheduleNames,...after.schedules.filter(row => !preview.snapshot.scheduleNames.some(name => name.id === row.id))] };
      return <div className="financial-section" key={step.id}>
        <h3>Change {index + 1} · {step.command === 'transactions-batch-update' ? 'Actual entries' : step.command === 'schedule/create' ? 'Create schedule' : step.command === 'schedule/delete' ? 'Retire schedule' : step.command === 'rule-delete' ? 'Remove unused schedule instructions' : 'Update schedule'}</h3>
        {step.after.transactions?.map(entry => <TransactionChanges key={entry.id} before={before.transactions.find(row => row.id === entry.id && !row.tombstone)} after={entry} snapshot={snapshot} />)}
        {step.after.schedule && <table className="financial-table"><thead><tr><th>Schedule</th><th>Before</th><th>After</th></tr></thead><tbody>
          {['name','posts_transaction','completed','active'].filter(field => step.after.schedule![field] !== undefined && (!oldSchedule || oldSchedule[field] !== step.after.schedule![field])).map(field => <tr key={field}><th>{labels[field]}</th><td>{oldSchedule ? displayValue(field,oldSchedule[field],snapshot) : 'No schedule'}</td><td>{displayValue(field,step.after.schedule![field],snapshot)}</td></tr>)}
        </tbody></table>}
        {step.after.conditions && <table className="financial-table"><thead><tr><th>Schedule field</th><th>Before</th><th>After</th></tr></thead><tbody>{conditionFields.map(field => {
          const previous = oldConditions.filter(condition => normalizedField(condition.field) === field);
          const next = conditions.filter(condition => normalizedField(condition.field) === field);
          const describe = (items:Record<string,unknown>[]) => items.map(condition => `${condition.op && condition.op !== 'is' ? `${String(condition.op).replace(/-/g,' ')} ` : ''}${displayValue(field,condition.value,snapshot)}`).join('; ') || 'None';
          return <tr key={field}><th>{labels[field] || field.replace(/_/g,' ')}</th><td>{describe(previous)}</td><td>{describe(next)}</td></tr>;
        })}</tbody></table>}
        {step.after.nextDate !== undefined && <p>Next occurrence: {scheduleId ? dateLabel(nextOccurrence(before,scheduleId)) || 'None' : 'None'} → {dateLabel(step.after.nextDate)}</p>}
        {step.after.removedScheduleId && <p>Remove {nameFor(snapshot.scheduleNames,step.after.removedScheduleId)} and its supported occurrence. Existing linked history is checked before saving.</p>}
        {step.after.removedRuleId && <p>Remove the unused instructions left by the earlier incomplete schedule. Its references are checked again before removal.</p>}
        {(step.after.ruleActions || step.after.scheduleActions) && <ActionChanges before={oldRule?.actions} after={step.after.ruleActions?.actions || step.after.scheduleActions} snapshot={snapshot} />}
      </div>;
    })}
    {!preview.steps.length && <p>No changes are needed.</p>}
    <p className="financial-note">Actual and the source are checked again when you save. If either changed, this preview will not authorize different changes.</p>
  </section>;
}
