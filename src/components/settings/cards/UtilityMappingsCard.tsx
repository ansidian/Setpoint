import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Droplets, Flame, Link2, PlugZap, Trash2, Wifi, Zap, type LucideIcon } from 'lucide-react';
import { getUtilityMappings, updateSettings, updateUtilityMapping } from '@/api';
import AnimatedCollapse from '@/components/shared/AnimatedCollapse';
import SearchableDropdown from '@/components/shared/SearchableDropdown';
import UtilityPayLinksCard, { PayLinkSummary, UtilityPayUrlField, type UtilityEditorControls, type UtilityPayLinksMetadataProps } from './UtilityPayLinksCard';
import { payLinkHost, replacePayLink, utilityScheduleOptions } from './utilitySettingsModel';
import type { SettingsCardStateProps } from '../settingsTypes';
import { SettingsCard, SettingsNotice } from '../settings-ui';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS, SURFACE_ROW_CLASS } from '../settings-core';
import type { UtilityIdentity, UtilityMappingSettings } from '../../../../shared/types/finances';
import type { UtilityPayLink } from '../../../../shared/types/settings';

const utilityIcons: Record<string, LucideIcon> = { electricity: Zap, gas: Flame, internet: Wifi, trash: Trash2, water: Droplets };
const buttonClass = 'min-h-9 max-[600px]:min-h-11 shrink-0 rounded-md px-3 py-1.5 text-xs transition-[color,background-color,border-color,transform] duration-150 focus-visible:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none motion-reduce:transition-none motion-reduce:transform-none';

type UtilityMappingsProps = Pick<SettingsCardStateProps, 'settings' | 'setSettings'> & UtilityPayLinksMetadataProps & { budgetId: string; available: boolean; showOtherLinks?: boolean };

export default function UtilityMappingsCard({ budgetId, available, settings, setSettings, showOtherLinks = true, ...metadataProps }: UtilityMappingsProps) {
  const [data, setData] = useState<UtilityMappingSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const links = settings?.utility_pay_links || [];
  useEffect(() => {
    let active = true;
    void getUtilityMappings().then(result => { if (active) setData(result); }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Utility mappings could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [budgetId, request]);
  const retry = () => { setLoading(true); setError(''); setRequest(value => value + 1); };
  const editor: UtilityEditorControls = {
    activeKey,
    session: editorSession,
    // Reset only the form each session; the collapse must stay mounted to animate opening.
    open: (key, trigger) => { triggerRef.current = trigger; setNotice(''); setEditorSession(value => value + 1); setActiveKey(key); },
    close: (message, fallback) => {
      const trigger = triggerRef.current;
      setActiveKey(null);
      if (message) setNotice(message);
      // Let the schedule picker release its portal focus before restoring the row trigger.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const target = trigger?.isConnected ? trigger : fallback;
        if (target?.isConnected && !target.disabled) target.focus();
      }));
    },
  };
  const saveLinks = async (next: UtilityPayLink[]) => {
    await updateSettings({ utility_pay_links: next });
    setSettings(current => ({ ...current, utility_pay_links: next }));
    sessionStorage.setItem('ea_settings_changed', '1');
    window.dispatchEvent(new Event('ea-settings-changed'));
  };
  const mappingSaved = (saved: UtilityIdentity) => {
    setData(current => current && ({ ...current, utilities: current.utilities.map(row => row.id === saved.id ? saved : row) }));
    window.dispatchEvent(new Event('ea-actual-metadata-invalidated'));
  };
  const disabled = loading || !available || !data?.metadataAvailable || data.budgetId !== budgetId;
  return <SettingsCard id="utility-mappings" title="Utilities & pay links" icon={<Link2 size={14}/>} description="Link each utility to its schedule in Actual. Optional pay links appear in the calendar.">
    {loading && <p className="text-xs text-muted-foreground">Loading utility mappings…</p>}
    {error && <SettingsNotice tone="danger" title="Couldn’t load utility mappings" className="mb-3">{error}</SettingsNotice>}
    {!loading && (!data?.metadataAvailable || error) && <div className="mb-3 flex items-center gap-3"><p className="text-xs text-muted-foreground">Refresh Actual data or repair the connection to edit mappings.</p><button type="button" disabled={!!activeKey} className={`${buttonClass} ${SETTINGS_SECONDARY_BUTTON_CLASS}`} onClick={retry}>Retry</button></div>}
    {notice && <p className="mb-2 text-xs text-primary" role="status">{notice}</p>}
    <div>
      {data?.utilities.map(utility => {
        const UtilityIcon = utilityIcons[utility.id] || PlugZap;
        const scheduleId = utility.scheduleIds.length === 1 ? utility.scheduleIds[0]! : '';
        const schedule = data.schedules.find(row => row.id === scheduleId);
        const name = schedule?.name || utility.provider || 'Saved schedule';
        const availableSchedule = utilityScheduleOptions(data, utility).find(row => row.id === scheduleId);
        const problem = !scheduleId ? 'Choose one schedule' : !data.metadataAvailable ? '' : !availableSchedule ? 'Schedule unavailable' : availableSchedule.payee.id !== utility.payeeId ? 'Payee changed in Actual' : '';
        const active = activeKey === `utility:${utility.id}`;
        return <section key={utility.id} className={`${SURFACE_ROW_CLASS} px-3 py-2`} aria-label={`${utility.label} mapping`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5 sm:grid sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-x-3 sm:space-y-0 xl:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold"><UtilityIcon size={15} strokeWidth={1.7} className="shrink-0 text-primary/80" aria-hidden="true"/>{utility.label}</h3>
              <div className="min-w-0"><p className="truncate text-xs" title={name}>{name}</p>{problem && <p className="mt-1 flex items-center gap-1.5 text-[11px] text-warning"><AlertTriangle size={12} className="shrink-0" aria-hidden="true"/>{problem}</p>}</div>
              <div className="min-w-0 sm:col-start-2 sm:mt-1 xl:col-start-auto xl:mt-0"><PayLinkSummary url={links.find(link => link.scheduleId === scheduleId)?.url || ''}/></div>
            </div>
            <button type="button" aria-label={`Edit ${utility.label}`} aria-expanded={active} aria-controls={`utility-editor-${utility.id}`} disabled={disabled || !!activeKey}
              onClick={event => editor.open(`utility:${utility.id}`, event.currentTarget)} className={`${buttonClass} ${SETTINGS_SECONDARY_BUTTON_CLASS}`}>Edit</button>
          </div>
          <AnimatedCollapse open={active}><div id={`utility-editor-${utility.id}`}><MappingEditor key={editorSession} utility={utility} data={data} links={links} saveLinks={saveLinks} disabled={disabled} onMappingSaved={mappingSaved} onClose={editor.close}/></div></AnimatedCollapse>
        </section>;
      })}
    </div>
    {!loading && data && !data.utilities.length && <p className="text-xs text-muted-foreground">No utilities are configured for this budget.</p>}
    {showOtherLinks && <UtilityPayLinksCard {...metadataProps} links={links} saveLinks={saveLinks} editor={editor} liveMetadataAvailable={available && !loading && !!data && data.budgetId === budgetId}
      mappedScheduleIds={data?.budgetId === budgetId ? data.utilities.filter(row => row.scheduleIds.length === 1).flatMap(row => row.scheduleIds) : []}/>}
  </SettingsCard>;
}

function MappingEditor({ utility, data, links, saveLinks, disabled, onMappingSaved, onClose }: {
  utility: UtilityIdentity; data: UtilityMappingSettings; links: UtilityPayLink[]; saveLinks: (links: UtilityPayLink[]) => Promise<void>;
  disabled: boolean; onMappingSaved: (utility: UtilityIdentity) => void; onClose: (notice?: string) => void;
}) {
  const [scheduleId, setScheduleId] = useState(utility.scheduleIds.length === 1 ? utility.scheduleIds[0]! : '');
  const [url, setUrl] = useState(links.find(link => link.scheduleId === scheduleId)?.url || '');
  const [saving, setSaving] = useState(false);
  const [mappingWasSaved, setMappingWasSaved] = useState(false);
  const [error, setError] = useState('');
  const [errorTitle, setErrorTitle] = useState('Couldn’t save changes');
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.focus(); }, []);
  const schedules = utilityScheduleOptions(data, utility);
  const selected = schedules.find(schedule => schedule.id === scheduleId);
  const payeeId = selected?.payee.id || utility.payeeId;
  const payeeName = selected?.payee.name || data.payees.find(payee => payee.id === utility.payeeId)?.name;
  const options = schedules.map(schedule => ({ id: schedule.id, name: schedule.name === schedule.payee.name ? schedule.name : `${schedule.name} · ${schedule.payee.name}` }));
  if (scheduleId && !selected) options.unshift({ id: scheduleId, name: data.schedules.find(schedule => schedule.id === scheduleId)?.name || 'Saved schedule unavailable' });
  const mappingChanged = payeeId !== utility.payeeId || utility.scheduleIds.length !== 1 || scheduleId !== utility.scheduleIds[0];
  const savedUrl = links.find(link => link.scheduleId === scheduleId)?.url || '';
  const linkChanged = url.trim() !== savedUrl;
  const invalidUrl = !!url.trim() && !payLinkHost(url);
  const oldLinkRemains = mappingChanged && links.some(link => utility.scheduleIds.includes(link.scheduleId));
  const save = async () => {
    if (disabled || saving || !selected || invalidUrl || (!mappingChanged && !linkChanged) || !data.budgetId) return;
    setSaving(true); setError('');
    let savedMapping = false;
    try {
      if (mappingChanged) {
        onMappingSaved(await updateUtilityMapping(utility.id, { budgetId: data.budgetId, payeeId, scheduleIds: [scheduleId] }));
        savedMapping = true;
        setMappingWasSaved(true);
      }
      if (linkChanged) await saveLinks(replacePayLink(links, scheduleId, url.trim() ? { scheduleId, label: utility.label, url } : null));
      onClose(`${utility.label} saved.`);
    } catch (reason) {
      setErrorTitle(savedMapping || (mappingWasSaved && !mappingChanged) ? 'Schedule saved; pay link wasn’t saved' : 'Couldn’t save changes');
      setError(reason instanceof Error ? reason.message : 'Your changes are still here. Try saving again.');
    } finally { setSaving(false); }
  };
  return <form ref={formRef} tabIndex={-1} aria-label={`Edit ${utility.label}`} className="space-y-3 pt-3 outline-none" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="grid items-start gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">Actual schedule</p>
        <SearchableDropdown ariaLabel={`${utility.label} Actual Schedule`} options={options} value={scheduleId} disabled={disabled || saving} onChange={value => { setScheduleId(value); setUrl(links.find(link => link.scheduleId === value)?.url || ''); setError(''); }} placeholder="Choose schedule"/>
        <p className="flex items-center gap-1.5 pt-1 text-[11px] leading-relaxed text-muted-foreground"><Link2 size={12} className="shrink-0" aria-hidden="true"/><span>{payeeName ? `Payee ${payeeName}` : 'Payee unavailable'}</span></p>
      </div>
      <UtilityPayUrlField id={id} label={utility.label} value={url} onChange={value => { setUrl(value); setError(''); }} disabled={disabled || saving || !selected}/>
    </div>
    {!selected && !disabled && <SettingsNotice title="Schedule needed">Choose an available bill schedule with a linked Actual payee.</SettingsNotice>}
    {oldLinkRemains && <p className="text-xs text-muted-foreground">The previous schedule’s pay link will remain in Other bill pay links.</p>}
    {error && <SettingsNotice tone="danger" title={errorTitle}>{error}</SettingsNotice>}
    <p className="text-[11px] text-muted-foreground">Edits save only when you choose Save changes.</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={disabled || saving || !selected || invalidUrl || (!mappingChanged && !linkChanged)} className={`${buttonClass} ${SETTINGS_PRIMARY_BUTTON_CLASS}`}>{saving ? 'Saving…' : 'Save changes'}</button>
      <button type="button" disabled={saving} onClick={() => onClose()} className={`${buttonClass} ${SETTINGS_SECONDARY_BUTTON_CLASS}`}>{mappingWasSaved ? 'Close' : 'Cancel'}</button>
    </div>
  </form>;
}
