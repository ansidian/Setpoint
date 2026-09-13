import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Link2, Plus } from 'lucide-react';
import AnimatedCollapse from '@/components/shared/AnimatedCollapse';
import SearchableDropdown from '@/components/shared/SearchableDropdown';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS, SURFACE_ROW_CLASS } from '../settings-core';
import { SettingsNotice } from '../settings-ui';
import { payLinkHost, replacePayLink, scheduleLabel } from './utilitySettingsModel';
import type { ActualMetadataResponse } from '../../../../shared/types/bills';
import type { UtilityPayLink } from '../../../../shared/types/settings';

const buttonClass = 'min-h-9 max-[600px]:min-h-11 shrink-0 rounded-md px-3 py-1.5 text-xs transition-[color,background-color,border-color,transform] duration-150 focus-visible:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none motion-reduce:transition-none motion-reduce:transform-none';

export interface UtilityEditorControls {
  activeKey: string | null;
  session: number;
  open: (key: string, trigger: HTMLButtonElement) => void;
  close: (notice?: string, fallback?: HTMLButtonElement | null) => void;
}

export interface UtilityPayLinksMetadataProps {
  metadata?: ActualMetadataResponse | null;
  metadataLoading?: boolean;
  metadataError?: string;
  onRequestMetadata?: () => unknown;
}

interface PayLinksProps extends UtilityPayLinksMetadataProps {
  links: UtilityPayLink[];
  saveLinks: (links: UtilityPayLink[]) => Promise<void>;
  editor: UtilityEditorControls;
  mappedScheduleIds: string[];
  liveMetadataAvailable: boolean;
}

export default function UtilityPayLinksCard(props: PayLinksProps) {
  const { links, editor, mappedScheduleIds, liveMetadataAvailable, metadata, metadataLoading, metadataError, onRequestMetadata } = props;
  const otherLinks = links.filter(link => !mappedScheduleIds.includes(link.scheduleId));
  const addRef = useRef<HTMLButtonElement>(null);
  const newEditorId = useId();
  return <div className="mt-3 border-t border-white/[0.06] pt-3">
    <div className="mb-1 flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">Other bill <span className="whitespace-nowrap">pay links <span className="ml-1 tabular-nums">{otherLinks.length}</span></span></h3>
      <button ref={addRef} type="button" disabled={!liveMetadataAvailable || !!editor.activeKey || metadataLoading} aria-expanded={editor.activeKey === 'new-link'} aria-controls={newEditorId}
        onClick={event => { onRequestMetadata?.(); editor.open('new-link', event.currentTarget); }}
        className={`${buttonClass} ${SETTINGS_SECONDARY_BUTTON_CLASS} inline-flex items-center gap-1.5`}><Plus size={13} aria-hidden="true"/>Add pay link</button>
    </div>
    {metadataError && <SettingsNotice tone="danger" title="Actual schedules are unavailable" className="mb-2">Try again in Financial profiles or repair the Actual Budget connection.</SettingsNotice>}
    <div>
      {otherLinks.map(link => {
        const schedule = metadata?.schedules?.find(row => row.id === link.scheduleId);
        const name = scheduleLabel(schedule, metadata?.payeeMap || {}) || (link.label !== link.scheduleId && link.label) || 'Saved bill';
        const unavailable = liveMetadataAvailable && !metadataLoading && !metadataError && !!metadata && (!schedule || schedule.completed || schedule.type === 'income');
        const active = editor.activeKey === `link:${link.scheduleId}`;
        return <section key={link.scheduleId} aria-label={`${name} pay link`} className={`${SURFACE_ROW_CLASS} px-3 py-2`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 sm:grid sm:grid-cols-2 sm:items-center sm:gap-3">
              <div className="min-w-0"><h4 className="break-words text-[13px] font-medium">{name}</h4>{unavailable && <p className="mt-1 flex items-center gap-1.5 text-[11px] text-warning"><AlertTriangle size={12} aria-hidden="true"/>Schedule unavailable</p>}</div>
              <PayLinkSummary url={link.url}/>
            </div>
            <button type="button" aria-label={`Edit ${name} pay link`} aria-expanded={active} aria-controls={`pay-link-editor-${link.scheduleId}`} disabled={!!editor.activeKey}
              onClick={event => { onRequestMetadata?.(); editor.open(`link:${link.scheduleId}`, event.currentTarget); }} className={`${buttonClass} ${SETTINGS_SECONDARY_BUTTON_CLASS}`}>Edit</button>
          </div>
          <AnimatedCollapse open={active}><div id={`pay-link-editor-${link.scheduleId}`}><PayLinkEditor key={editor.session} {...props} link={link} onClose={message => editor.close(message, addRef.current)}/></div></AnimatedCollapse>
        </section>;
      })}
    </div>
    <AnimatedCollapse open={editor.activeKey === 'new-link'}><div id={newEditorId} className="px-3 pb-2"><PayLinkEditor key={editor.session} {...props} onClose={editor.close}/></div></AnimatedCollapse>
    {!otherLinks.length && editor.activeKey !== 'new-link' && <p className="px-3 py-2 text-xs text-muted-foreground">No additional pay links.</p>}
  </div>;
}

function PayLinkEditor({ link, links, saveLinks, mappedScheduleIds, metadata, metadataLoading, onRequestMetadata, liveMetadataAvailable, onClose }: PayLinksProps & { link?: UtilityPayLink; onClose: (notice?: string) => void }) {
  const [scheduleId, setScheduleId] = useState(link?.scheduleId || '');
  const [url, setUrl] = useState(link?.url || '');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.focus(); }, []);
  const schedules = (metadata?.schedules || []).filter(schedule => schedule.id && schedule.type !== 'income' && !schedule.completed);
  const usedElsewhere = new Set([...mappedScheduleIds, ...links.filter(row => row.scheduleId !== link?.scheduleId).map(row => row.scheduleId)]);
  const options = schedules.filter(schedule => !usedElsewhere.has(schedule.id!)).map(schedule => ({ id: schedule.id!, name: scheduleLabel(schedule, metadata?.payeeMap || {}) }));
  const selected = options.find(option => option.id === scheduleId);
  if (link && !options.some(option => option.id === link.scheduleId)) options.unshift({ id: link.scheduleId, name: (link.label !== link.scheduleId && link.label) || 'Saved schedule unavailable' });
  // An existing URL can still be repaired or removed while Actual is offline.
  const canUseSchedule = !!selected || (!!link && scheduleId === link.scheduleId);
  const changed = scheduleId !== link?.scheduleId || url.trim() !== link?.url;
  const save = async (remove = false) => {
    if (saving || (!remove && (!canUseSchedule || !payLinkHost(url) || !changed))) return;
    setSaving(true); setRemoving(remove); setError('');
    try {
      await saveLinks(replacePayLink(links, link?.scheduleId || '', remove ? null : { scheduleId, label: selected?.name || link?.label || '', url }));
      onClose(remove ? 'Pay link removed.' : 'Pay link saved.');
    } catch (reason) { setError(`${remove ? 'Couldn’t remove the link.' : 'Couldn’t save the link.'} ${reason instanceof Error ? reason.message : 'Try again.'}`); }
    finally { setSaving(false); setRemoving(false); }
  };
  return <form ref={formRef} tabIndex={-1} aria-label={link ? 'Edit bill pay link' : 'Add bill pay link'} className="space-y-3 pt-3 outline-none" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="grid items-start gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1"><p className="text-xs text-muted-foreground">Actual schedule</p>
        <SearchableDropdown ariaLabel="Schedule for pay link" options={options} value={scheduleId} placeholder="Select a bill…" disabled={saving || metadataLoading || !liveMetadataAvailable} onOpen={() => onRequestMetadata?.()} onChange={value => { setScheduleId(value); setError(''); }}/>
      </div>
      <UtilityPayUrlField id={id} label="Bill" value={url} onChange={value => { setUrl(value); setError(''); }} disabled={saving} optional={false}/>
    </div>
    {error && <SettingsNotice tone="danger" title="Pay link not saved">{error}</SettingsNotice>}
    <p className="text-[11px] text-muted-foreground">Edits save only when you choose Save changes.</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={saving || !changed || !canUseSchedule || !payLinkHost(url)} className={`${buttonClass} ${SETTINGS_PRIMARY_BUTTON_CLASS}`}>{saving && !removing ? 'Saving…' : 'Save changes'}</button>
      <button type="button" disabled={saving} onClick={() => onClose()} className={`${buttonClass} ${SETTINGS_SECONDARY_BUTTON_CLASS}`}>Cancel</button>
      {link && <button type="button" disabled={saving} onClick={() => void save(true)} className={`${buttonClass} ml-auto border border-transparent text-danger hover:-translate-y-px hover:border-danger/20 hover:bg-danger/10 active:translate-y-0`}>{removing ? 'Removing…' : 'Remove link'}</button>}
    </div>
  </form>;
}

export function PayLinkSummary({ url }: { url: string }) {
  const host = payLinkHost(url);
  return <p className={`flex min-w-0 items-center gap-1.5 text-xs ${url && !host ? 'text-warning' : 'text-muted-foreground'}`}>
    {url && <Link2 size={12} className="shrink-0" aria-hidden="true"/>}<span className="truncate" title={url || undefined}>{url ? host || 'Check pay link' : 'No pay link'}</span>
  </p>;
}

export function UtilityPayUrlField({ id, label, value, onChange, disabled, optional = true }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; optional?: boolean }) {
  const invalid = !!value.trim() && !payLinkHost(value);
  return <div className="min-w-0 space-y-1">
    <label htmlFor={`${id}-url`} className="block text-xs text-muted-foreground">Pay link {optional && <span>(optional)</span>}</label>
    <input id={`${id}-url`} aria-label={`${label} pay link${optional ? ' (optional)' : ''}`} type="url" inputMode="url" value={value} placeholder="https://…" disabled={disabled} required={!optional} aria-invalid={invalid} aria-describedby={invalid ? `${id}-url-error` : undefined}
      onChange={event => onChange(event.target.value)}
      className="min-h-9 max-[600px]:min-h-11 w-full min-w-0 rounded-md border border-white/[0.08] bg-input-bg px-2.5 py-1.5 text-[13px] max-[600px]:text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-white/[0.16] focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary aria-invalid:border-danger/60 disabled:cursor-not-allowed disabled:opacity-45"/>
    {invalid && <p id={`${id}-url-error`} role="alert" className="text-xs text-danger">Enter a full URL starting with https:// or http://.</p>}
  </div>;
}
