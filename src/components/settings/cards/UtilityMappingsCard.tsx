import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Droplets, Flame, Link2, PlugZap, Trash2, Wifi, Zap, type LucideIcon } from 'lucide-react';
import { getUtilityMappings, updateUtilityMapping } from '@/api';
import AnimatedCollapse from '@/components/shared/AnimatedCollapse';
import SearchableDropdown from '@/components/shared/SearchableDropdown';
import { UtilityPayUrlField } from './UtilityPayLinksCard';
import type { SettingsCardStateProps } from '../settingsTypes';
import { SettingsCard } from '../settings-ui';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS, SURFACE_ROW_CLASS } from '../settings-core';
import type { UtilityIdentity, UtilityMappingSettings } from '../../../../shared/types/finances';

const utilityIcons: Record<string, LucideIcon> = { electricity: Zap, gas: Flame, internet: Wifi, trash: Trash2, water: Droplets };

const buttonClass = 'min-h-8 rounded-md px-3 py-1.5 text-xs transition-[color,background-color,transform] duration-150 focus-visible:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none motion-reduce:transition-none motion-reduce:transform-none';
export default function UtilityMappingsCard({ budgetId, available, children, ...settingsProps }: SettingsCardStateProps & { budgetId: string; available: boolean; children?: (scheduleIds: string[]) => ReactNode }) {
  const [data, setData] = useState<UtilityMappingSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void getUtilityMappings().then(result => { if (active) setData(result); }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Utility mappings could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [budgetId, request]);
  const retry = () => { setLoading(true); setError(''); setRequest(value => value + 1); };
  return <div id="utility-mappings" tabIndex={-1} className="scroll-mt-6"><SettingsCard title="Utility mappings" icon={<Link2 size={14}/>} description="Choose each utility’s Actual Schedule; its payee is linked automatically. Add a pay link for the calendar’s Pay Online action.">
    {loading && <p className="text-xs text-muted-foreground">Loading utility mappings…</p>}
    {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    {!loading && (!data?.metadataAvailable || error) && <div className="flex items-center gap-3"><p className="text-xs text-muted-foreground">Refresh Actual data or repair the connection to edit mappings.</p><button className={`${buttonClass} ${SETTINGS_SECONDARY_BUTTON_CLASS}`} onClick={retry}>Retry</button></div>}
    {notice && <p className="text-xs text-primary" role="status">{notice}</p>}
    {data?.utilities.map(utility => <MappingEditor key={`${utility.id}:${utility.payeeId}:${utility.scheduleIds.join(',')}`} utility={utility} data={data} settingsProps={settingsProps} disabled={loading || !available || !data.metadataAvailable || data.budgetId !== budgetId} onSaved={saved => {
      setData(current => current && ({ ...current, utilities: current.utilities.map(row => row.id === saved.id ? saved : row) }));
      setNotice(`${saved.label} mapping saved.`);
      window.dispatchEvent(new Event('ea-actual-metadata-invalidated'));
    }}/>) }
    {!loading && data && !data.utilities.length && <p className="text-xs text-muted-foreground">No utilities are configured for this budget.</p>}
    {children?.(data?.budgetId === budgetId ? data.utilities.filter(row => row.scheduleIds.length === 1).flatMap(row => row.scheduleIds) : [])}
  </SettingsCard></div>;
}
function MappingEditor({ utility, data, disabled, onSaved, settingsProps }: { settingsProps: SettingsCardStateProps; utility: UtilityIdentity; data: UtilityMappingSettings; disabled: boolean; onSaved: (utility: UtilityIdentity) => void }) {
  const UtilityIcon = utilityIcons[utility.id] || PlugZap;
  const [scheduleId, setScheduleId] = useState(utility.scheduleIds.length === 1 ? utility.scheduleIds[0]! : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const payees = data.payees.filter(payee => !payee.transfer_acct);
  const assignedElsewhere = new Set(data.utilities.filter(row => row.id !== utility.id).flatMap(row => row.scheduleIds));
  const schedules = data.schedules.flatMap(schedule => {
    const conditions = (schedule.conditions || []).filter(condition => condition.field === 'payee');
    const payee = conditions.length === 1 && conditions[0]?.op === 'is'
      ? payees.find(row => row.id === conditions[0]?.value) : undefined;
    if (!schedule.id || assignedElsewhere.has(schedule.id) || schedule.completed || schedule.type !== 'bill' || !payee) return [];
    const name = schedule.name || payee.name;
    return [{ id: schedule.id, name: name === payee.name ? name : `${name} · ${payee.name}`, content: <span className="font-semibold">{name}</span>, payee }];
  });
  const selected = schedules.find(schedule => schedule.id === scheduleId);
  const payeeId = selected?.payee.id || utility.payeeId;
  const payeeName = selected?.payee.name || payees.find(payee => payee.id === utility.payeeId)?.name;
  const options = [...schedules, ...[scheduleId].filter(id => id && !schedules.some(schedule => schedule.id === id)).map(id => ({ id, name: data.schedules.find(schedule => schedule.id === id)?.name || 'Saved schedule unavailable' }))];
  const changed = payeeId !== utility.payeeId || utility.scheduleIds.length !== 1 || scheduleId !== utility.scheduleIds[0];
  const problem = !selected ? 'Choose an available bill schedule with a linked Actual payee.' : '';
  const save = async () => {
    if (disabled || saving || !changed || problem || !data.budgetId) return;
    setSaving(true); setError('');
    try { onSaved(await updateUtilityMapping(utility.id, { budgetId: data.budgetId, payeeId, scheduleIds: [scheduleId] })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The mapping could not be saved.'); }
    finally { setSaving(false); }
  };
  return <section className={`${SURFACE_ROW_CLASS} px-3 py-3`} aria-label={`${utility.label} mapping`}>
    <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
      <h3 className="flex items-center gap-2 text-sm font-semibold sm:col-span-2 xl:col-span-1 xl:pt-6"><UtilityIcon size={16} strokeWidth={1.7} className="shrink-0 text-primary/80" aria-hidden="true"/>{utility.label}</h3>
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Actual Schedule</p>
        <SearchableDropdown ariaLabel={`${utility.label} Actual Schedule`} options={options} value={scheduleId} disabled={disabled || saving} onChange={value => { setScheduleId(value); setError(''); }} placeholder="Choose schedule"/>
        <p className="flex items-center gap-1.5 pt-1 text-[11px] leading-relaxed text-muted-foreground"><Link2 size={12} className="shrink-0" aria-hidden="true"/><span>{payeeName ? <>Payee <span className="ml-1">{payeeName}</span></> : 'Payee unavailable'}</span></p>
      </div>
      <UtilityPayUrlField key={utility.scheduleIds.join(',')} {...settingsProps} scheduleId={utility.scheduleIds.length === 1 ? utility.scheduleIds[0]! : ''} label={utility.label} disabled={changed || saving || disabled}/>
    </div>
    {problem && !disabled && <p id={`mapping-problem-${utility.id}`} className="mt-2 text-xs text-muted-foreground">{problem}</p>}
    {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
    <AnimatedCollapse open={changed}><div className="pt-2 flex items-center gap-3">
      <button className={`${buttonClass} ${SETTINGS_PRIMARY_BUTTON_CLASS}`} disabled={disabled || saving || !!problem} aria-describedby={problem && !disabled ? `mapping-problem-${utility.id}` : undefined} onClick={() => void save()}>{saving ? 'Saving…' : 'Save mapping'}</button>
      <span className="text-xs text-muted-foreground">Save the mapping before editing its pay link.</span>
    </div></AnimatedCollapse>
  </section>;
}
