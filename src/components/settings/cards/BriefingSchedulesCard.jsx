import { useEffect, useRef, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { skipSchedule } from "@/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  SettingsCard,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_SECONDARY_BUTTON_CLASS,
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";

export default function BriefingSchedulesCard({ settings, setSettings, patch }) {
  const [editingTimeIdx, setEditingTimeIdx] = useState(null);
  const [frozenOrder, setFrozenOrder] = useState(null);
  const schedContainerRef = useRef(null);
  const schedRectsRef = useRef({});
  const prevSortOrderRef = useRef(null);
  const shouldAnimateRef = useRef(false);
  // Label value captured when a label input gains focus, so a blank-on-blur can
  // be restored to the prior non-blank label rather than persisted (P1-3).
  const labelDraftRef = useRef("");

  function captureRects() {
    if (!schedContainerRef.current) return;
    schedContainerRef.current
      .querySelectorAll("[data-sched-idx]")
      .forEach((element) => {
        schedRectsRef.current[element.dataset.schedIdx] = element.getBoundingClientRect().top;
      });
  }

  const items = [...(settings?.schedules || [])].map((schedule, index) => ({ ...schedule, _oi: index }));
  const sortedItems = [...items].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const sortOrder = sortedItems.map((schedule) => schedule._oi).join(",");

  useEffect(() => {
    if (editingTimeIdx !== null) return;
    if (prevSortOrderRef.current && prevSortOrderRef.current !== sortOrder) {
      shouldAnimateRef.current = true;
    }
    prevSortOrderRef.current = sortOrder;
  }, [editingTimeIdx, sortOrder]);

  const visibleSchedules = editingTimeIdx !== null && frozenOrder
    ? frozenOrder
        .split(",")
        .map(Number)
        .map((index) => items.find((schedule) => schedule._oi === index))
        .filter(Boolean)
    : sortedItems;

  return (
    <SettingsCard
      title="Snapshot Boundaries"
      icon={<CalendarClock size={14} />}
      description="Schedule times for rolling the active email snapshot window."
    >
      <div ref={schedContainerRef} className="flex flex-col gap-3">
        {visibleSchedules.map((schedule) => {
          const originalIndex = schedule._oi;
          const isSkipped = schedule.skipped_until && new Date(schedule.skipped_until) > new Date();
          return (
            <div
              key={originalIndex}
              data-sched-idx={originalIndex}
              ref={(element) => {
                if (!element) return;
                const prevTop = schedRectsRef.current[originalIndex];
                if (prevTop !== undefined && shouldAnimateRef.current) {
                  const currentTop = element.getBoundingClientRect().top;
                  const deltaY = prevTop - currentTop;
                  if (Math.abs(deltaY) > 1) {
                    element.style.transition = "none";
                    element.style.transform = `translateY(${deltaY}px)`;
                    requestAnimationFrame(() => {
                      element.style.transition = "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)";
                      element.style.transform = "";
                      shouldAnimateRef.current = false;
                    });
                  }
                }
                schedRectsRef.current[originalIndex] = element.getBoundingClientRect().top;
              }}
              className={cn(SURFACE_ROW_CLASS, "flex flex-col gap-3 p-3")}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <input
                  type="text"
                  value={schedule.label || ""}
                  placeholder="Label"
                  onChange={(event) => {
                    const updated = [...settings.schedules];
                    updated[originalIndex] = { ...updated[originalIndex], label: event.target.value };
                    setSettings((current) => ({ ...(current || {}), schedules: updated }));
                  }}
                  onFocus={() => {
                    labelDraftRef.current = settings.schedules?.[originalIndex]?.label || "";
                  }}
                  onBlur={() => {
                    const current = settings.schedules?.[originalIndex]?.label || "";
                    if (current.trim()) {
                      patch({ schedules_json: settings.schedules });
                      return;
                    }
                    // Never persist a blank label: the server validator rejects
                    // the whole PUT with a 400, which also drops every other
                    // setting co-batched in the same debounce window (P1-3).
                    // Restore the prior non-blank label, or fall back to the
                    // add-boundary default.
                    const fallback = labelDraftRef.current.trim() || "New Boundary";
                    const restored = [...settings.schedules];
                    restored[originalIndex] = { ...restored[originalIndex], label: fallback };
                    setSettings((cur) => ({ ...(cur || {}), schedules: restored }));
                    patch({ schedules_json: restored });
                  }}
                  className="min-w-0 flex-1 bg-transparent p-0 text-[13px] font-medium text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    captureRects();
                    const updated = settings.schedules.filter((_, index) => index !== originalIndex);
                    setSettings((current) => ({ ...(current || {}), schedules: updated }));
                    patch({ schedules_json: updated });
                  }}
                  className="inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-white/[0.04] hover:text-danger"
                  aria-label="Remove boundary"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="time"
                  value={schedule.time || "08:00"}
                  onFocus={() => {
                    setFrozenOrder(sortOrder);
                    setEditingTimeIdx(originalIndex);
                  }}
                  onBlur={() => {
                    captureRects();
                    const current = settings.schedules?.[originalIndex]?.time || "";
                    if (current.trim()) {
                      patch({ schedules_json: settings.schedules });
                    } else {
                      // Never persist a blank time: the server validator rejects
                      // the whole PUT with a 400, dropping every co-batched
                      // setting — and the autosave re-queue would then re-send
                      // the invalid payload on every flush (P1-3). Restore the
                      // default, matching the value fallback above.
                      const restored = [...settings.schedules];
                      restored[originalIndex] = { ...restored[originalIndex], time: "08:00" };
                      setSettings((cur) => ({ ...(cur || {}), schedules: restored }));
                      patch({ schedules_json: restored });
                    }
                    setEditingTimeIdx(null);
                    setFrozenOrder(null);
                  }}
                  onChange={(event) => {
                    const updated = [...settings.schedules];
                    updated[originalIndex] = { ...updated[originalIndex], time: event.target.value };
                    setSettings((current) => ({ ...(current || {}), schedules: updated }));
                  }}
                  className="h-8 rounded-md border border-white/[0.08] bg-transparent px-2.5 text-xs text-muted-foreground/75 [color-scheme:dark]"
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!schedule.enabled}
                    onCheckedChange={() => {
                      const updated = [...settings.schedules];
                      updated[originalIndex] = {
                        ...updated[originalIndex],
                        enabled: !updated[originalIndex].enabled,
                      };
                      setSettings((current) => ({ ...(current || {}), schedules: updated }));
                      patch({ schedules_json: updated });
                    }}
                    aria-label={schedule.enabled ? "Disable boundary" : "Enable boundary"}
                  />
                  <span className="min-w-[52px] text-[11px] text-muted-foreground/75">
                    {schedule.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                {schedule.enabled ? (
                  <Button
                    variant="secondary"
                    className={SETTINGS_SECONDARY_BUTTON_CLASS}
                    size="xs"
                    aria-label={isSkipped ? "Boundary skipped today" : "Skip boundary today"}
                    onClick={async () => {
                      const result = await skipSchedule(originalIndex, !isSkipped);
                      if (result.schedules) {
                        setSettings((current) => ({ ...(current || {}), schedules: result.schedules }));
                      }
                    }}
                  >
                    {isSkipped ? "Skipped" : "Skip Today"}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            const updated = [
              ...(settings?.schedules || []),
              { label: "New Boundary", time: "08:00", enabled: false },
            ];
            setSettings((current) => ({ ...(current || {}), schedules: updated }));
            patch({ schedules_json: updated });
          }}
          className="rounded-lg border border-dashed border-white/[0.1] bg-transparent px-3.5 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:border-white/[0.2] hover:text-foreground"
        >
          + Add Boundary
        </button>
      </div>
    </SettingsCard>
  );
}
