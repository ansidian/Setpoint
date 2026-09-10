import { useState } from "react";
import { X } from "lucide-react";
import SearchableDropdown from "@/components/shared/SearchableDropdown";
import { SURFACE_ROW_CLASS } from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import type { ActualSchedule } from "../../../../shared/types/actual";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";
import type { UtilityPayLink } from "../../../../shared/types/settings";
import type { SettingsCardStateProps } from "../settingsTypes";

const URL_RE = /^https?:\/\//i;

function isCompleteLink(link: UtilityPayLink) {
  return !!link?.scheduleId && URL_RE.test(String(link?.url || "").trim());
}

function scheduleLabel(schedule: ActualSchedule | undefined, payeeMap: Record<string, string>) {
  if (!schedule) return "";
  if (schedule.name) return schedule.name;
  const payeeCond = schedule.conditions?.find((c) => c.field === "payee");
  const payeeValue = typeof payeeCond?.value === "string" ? payeeCond.value : null;
  return (payeeValue && payeeMap[payeeValue]) || "Unnamed schedule";
}

export default function UtilityPayLinksCard({
  settings,
  setSettings,
  patch,
  metadata,
  metadataLoading,
  metadataError,
  onRequestMetadata,
  liveMetadataAvailable = true,
  mappedScheduleIds = [],
}: SettingsCardStateProps & {
  mappedScheduleIds?: string[];
  metadata?: ActualMetadataResponse | null;
  metadataLoading?: boolean;
  metadataError?: string;
  onRequestMetadata?: () => unknown;
  liveMetadataAvailable?: boolean;
}) {
  // Finance loads metadata on arrival; these requests reuse its shared promise.
  const links = settings?.utility_pay_links || [];
  const schedules = (metadata?.schedules || []).filter((s) => s.type !== "income");
  const payeeMap = metadata?.payeeMap || {};

  // Persist only complete rows: a blank/half-filled row would 400 the whole PUT
  // and drop every co-batched setting. In-progress rows stay in local state.
  function applyLinks(nextLinks: UtilityPayLink[]) {
    setSettings((current) => ({ ...(current || {}), utility_pay_links: nextLinks }));
    patch({ utility_pay_links: nextLinks.filter(isCompleteLink) });
  }

  function updateLink(index: number, updater: (link: UtilityPayLink) => UtilityPayLink) {
    applyLinks(links.map((link, i) => (i === index ? updater(link) : link)));
  }

  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Other bill pay links</h3>
      <div className="flex flex-col gap-3">
        {metadataError ? (
          <div className="text-[12px] text-danger">Actual schedules are unavailable. Try again above or repair the connection.</div>
        ) : null}

        {links.map((link, index) => {
          if (mappedScheduleIds.includes(link.scheduleId)) return null;
          const usedElsewhere = new Set<string>(
            links.filter((_, i) => i !== index).map((l) => l.scheduleId).filter((id): id is string => !!id),
          );
          const scheduleOptions = schedules
            .filter((s) => !!s.id)
            .filter((s) => (!usedElsewhere.has(s.id!) && !mappedScheduleIds.includes(s.id!)) || s.id === link.scheduleId)
            .map((s) => ({ id: s.id!, name: scheduleLabel(s, payeeMap) }));
          // Show the saved schedule by its cached label before metadata loads (or
          // if it was later deleted in Actual), so a configured row never looks empty.
          if (link.scheduleId && !scheduleOptions.some((o) => o.id === link.scheduleId)) {
            scheduleOptions.unshift({ id: link.scheduleId, name: (link.label !== link.scheduleId && link.label) || (metadataLoading ? "Loading saved schedule…" : "Saved schedule unavailable") });
          }
          const urlInvalid = !!link.url && !URL_RE.test(String(link.url).trim());
          return (
            <div key={index} className={cn(SURFACE_ROW_CLASS, "grid items-center gap-2 px-3 py-2 sm:grid-cols-2")}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {liveMetadataAvailable ? (
                    <SearchableDropdown
                      ariaLabel="Schedule for pay link"
                      options={scheduleOptions}
                      value={link.scheduleId || ""}
                      placeholder={metadataLoading && !schedules.length ? "Loading schedules…" : "Select a bill…"}
                      onOpen={() => onRequestMetadata?.()}
                      onChange={(scheduleId) => {
                        const schedule = schedules.find((s) => s.id === scheduleId);
                        updateLink(index, (current) => ({
                          ...current,
                          scheduleId,
                          label: scheduleLabel(schedule, payeeMap),
                        }));
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled
                      aria-label="Schedule for pay link"
                      className="flex w-full items-center rounded bg-input-bg px-2.5 py-1.5 text-left text-[13px] font-medium text-muted-foreground/70 disabled:cursor-not-allowed"
                    >
                      {(link.label !== link.scheduleId && link.label) || "Repair Actual Budget to choose a bill"}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => applyLinks(links.filter((_, i) => i !== index))}
                  className="inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-md text-muted-foreground/45 outline-none transition-[color,background-color,transform,box-shadow] duration-[160ms] hover:-translate-y-px hover:bg-white/[0.04] hover:text-danger focus-visible:-translate-y-px focus-visible:bg-white/[0.04] focus-visible:text-danger focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
                  aria-label="Remove pay link"
                >
                  <X size={14} />
                </button>
              </div>
              <input
                aria-label="Bill pay URL"
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={link.url || ""}
                onChange={(event) =>
                  updateLink(index, (current) => ({ ...current, url: event.target.value }))
                }
                className="min-w-0 rounded-md border border-white/[0.08] bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/75 hover:border-white/[0.16] focus-visible:border-white/[0.24]"
              />
              {urlInvalid ? (
                <div className="text-[11px] text-danger">URL must start with http:// or https://</div>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          disabled={!liveMetadataAvailable}
          onClick={() => {
            onRequestMetadata?.();
            applyLinks([...links, { scheduleId: "", label: "", url: "" }]);
          }}
          className="rounded-lg border border-dashed border-white/[0.1] bg-transparent px-3.5 py-2 text-left text-[12px] font-medium text-muted-foreground transition-[border-color,color,transform] duration-200 hover:-translate-y-px hover:border-white/[0.2] hover:text-foreground focus-visible:-translate-y-px focus-visible:border-white/[0.2] focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
        >
          + Add pay link
        </button>
      </div>
    </div>
  );
}

/** URL drafts stay local until valid; clearing the field removes only this schedule's link. */
export function UtilityPayUrlField({ settings, setSettings, patch, scheduleId, label, disabled }: SettingsCardStateProps & { scheduleId: string; label: string; disabled: boolean }) {
  const savedUrl = settings?.utility_pay_links?.find(link => link.scheduleId === scheduleId)?.url || '';
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? savedUrl;
  const invalid = !!value.trim() && !URL_RE.test(value.trim());
  const save = () => {
    if (disabled || !scheduleId || invalid || draft === null) return;
    if (value.trim() === savedUrl) { setDraft(null); return; }
    const others = (settings?.utility_pay_links || []).filter(link => link.scheduleId !== scheduleId);
    const next = value.trim() ? [...others, { scheduleId, label, url: value.trim() }] : others;
    setSettings(current => ({ ...current, utility_pay_links: next }));
    patch({ utility_pay_links: next.filter(isCompleteLink) });
    setDraft(null);
  };
  return <div className="min-w-0 space-y-1">
    <label htmlFor={`utility-url-${label}`} className="block text-xs text-muted-foreground">Pay link <span className="font-normal">(optional)</span></label>
    <input id={`utility-url-${label}`} aria-label={`${label} pay link (optional)`} type="url" inputMode="url" value={value} placeholder="https://…" disabled={disabled || !scheduleId} aria-invalid={invalid} aria-describedby={invalid ? `utility-url-error-${label}` : undefined}
      onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }}
      className="w-full min-w-0 rounded-md border border-white/[0.08] bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-white/[0.16] focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45"/>
    {invalid && <p id={`utility-url-error-${label}`} className="text-xs text-danger">Use a URL starting with https:// or http://.</p>}
  </div>;
}
