import { Link2 } from 'lucide-react';
import { payLinkHost } from './utilitySettingsModel';

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
