import { CreditCard, X } from "lucide-react";
import SearchableDropdown from "@/components/shared/SearchableDropdown";
import { SettingsCard } from "@/components/settings/settings-ui";
import { SURFACE_ROW_CLASS } from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";

const URL_RE = /^https?:\/\//i;

function isCompleteLink(link) {
  return !!link?.scheduleId && URL_RE.test(String(link?.url || "").trim());
}

function scheduleLabel(schedule, payeeMap) {
  if (!schedule) return "";
  if (schedule.name) return schedule.name;
  const payeeCond = schedule.conditions?.find((c) => c.field === "payee");
  return (payeeCond && payeeMap?.[payeeCond.value]) || schedule.id;
}

export default function UtilityPayLinksCard({
  settings,
  setSettings,
  patch,
  metadata,
  metadataLoading,
  metadataError,
  onRequestMetadata,
}) {
  // Lazy metadata load (mirrors BillPayMappingsCard): the section must NOT spin
  // up the Actual worker on mount, so we request schedules only on first user
  // interaction (adding a row or opening a schedule dropdown).
  const links = settings?.utility_pay_links || [];
  const schedules = (metadata?.schedules || []).filter((s) => s.type !== "income");
  const payeeMap = metadata?.payeeMap || {};

  // Persist only complete rows: a blank/half-filled row would 400 the whole PUT
  // and drop every co-batched setting. In-progress rows stay in local state.
  function applyLinks(nextLinks) {
    setSettings((current) => ({ ...(current || {}), utility_pay_links: nextLinks }));
    patch({ utility_pay_links: nextLinks.filter(isCompleteLink) });
  }

  function updateLink(index, updater) {
    applyLinks(links.map((link, i) => (i === index ? updater(link) : link)));
  }

  return (
    <SettingsCard
      title="Utility Pay Links"
      icon={<CreditCard size={14} />}
      description="Attach a bill-pay website to a scheduled bill. A Pay Online button then appears on that bill in the calendar."
    >
      <div className="flex flex-col gap-3">
        {metadataError ? (
          <div className="text-[12px] text-danger">{metadataError}</div>
        ) : null}

        {links.map((link, index) => {
          const usedElsewhere = new Set(
            links.filter((_, i) => i !== index).map((l) => l.scheduleId).filter(Boolean),
          );
          const scheduleOptions = schedules
            .filter((s) => !usedElsewhere.has(s.id) || s.id === link.scheduleId)
            .map((s) => ({ id: s.id, name: scheduleLabel(s, payeeMap) }));
          // Show the saved schedule by its cached label before metadata loads (or
          // if it was later deleted in Actual), so a configured row never looks empty.
          if (link.scheduleId && !scheduleOptions.some((o) => o.id === link.scheduleId)) {
            scheduleOptions.unshift({ id: link.scheduleId, name: link.label || link.scheduleId });
          }
          const urlInvalid = !!link.url && !URL_RE.test(String(link.url).trim());
          return (
            <div key={index} className={cn(SURFACE_ROW_CLASS, "flex flex-col gap-3 p-3")}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
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
                </div>
                <button
                  type="button"
                  onClick={() => applyLinks(links.filter((_, i) => i !== index))}
                  className="inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-white/[0.04] hover:text-danger focus-visible:bg-white/[0.04] focus-visible:text-danger"
                  aria-label="Remove pay link"
                >
                  <X size={14} />
                </button>
              </div>
              <input
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={link.url || ""}
                onChange={(event) =>
                  updateLink(index, (current) => ({ ...current, url: event.target.value }))
                }
                className="min-w-0 rounded-md border border-white/[0.08] bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/75 hover:border-white/[0.16] focus:border-white/[0.24]"
              />
              {urlInvalid ? (
                <div className="text-[11px] text-danger">URL must start with http:// or https://</div>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            onRequestMetadata?.();
            applyLinks([...links, { scheduleId: "", label: "", url: "" }]);
          }}
          className="rounded-lg border border-dashed border-white/[0.1] bg-transparent px-3.5 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:border-white/[0.2] hover:text-foreground focus-visible:border-white/[0.2] focus-visible:text-foreground"
        >
          + Add pay link
        </button>
      </div>
    </SettingsCard>
  );
}
