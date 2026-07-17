import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { CalendarClock } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import type { CalendarDateTimeViewProps } from "@/components/shared/pickers/CalendarDateTimeView";
import {
  buildSnoozePresets,
  DASHBOARD_TZ,
} from "./helpers";

export function CustomDateTimeView(props: Omit<CalendarDateTimeViewProps, "confirmLabel">) {
  return <CalendarDateTimeView confirmLabel="Snooze" {...props} />;
}

// Floating picker anchored to the Snooze button. Follows the project's
// "Floating Panel Pattern" — portal, fixed positioning, isolated stacking,
// click-outside dismiss, and wheel-boundary capture so scroll inside the
// picker can't leak to the page.
export default function SnoozePicker({ anchorRef, onSelect, onClose, forceMobileSheet = false }: {
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (timestamp: number) => void;
  onClose: () => void;
  forceMobileSheet?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // View state: "presets" shows quick-picks, "custom" shows the calendar +
  // time view. Swapping views changes panel dimensions, so the placement
  // effect re-runs (view is in its dep array) to keep overflow handling sound.
  const [view, setView] = useState<"presets" | "custom">("presets");
  // nowTick drives live-updating preview text on "+6h" / "+24h" rows so the
  // labels stay accurate while the picker sits open. 60s cadence is coarse
  // enough to avoid needless renders and fine enough to feel fresh.
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    window.queueMicrotask(() => {
      panelRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
  }, [view]);

  const presets = buildSnoozePresets(nowTick);
  const panelW = view === "custom" ? 300 : 240;
  const panelH = view === "custom" ? 400 : 180;

  const handlePick = (ts: number) => { onSelect(ts); onClose(); };
  const handlePresetKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const next = current < 0 ? 0 : (current + offset + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <AnchoredFloatingPanel
      anchorRef={anchorRef}
      panelRef={panelRef}
      onClose={onClose}
      width={panelW}
      height={panelH}
      role="menu"
      ariaLabel="Snooze"
      forceMobileSheet={forceMobileSheet}
      mobileHeight={forceMobileSheet && view === "presets" ? null : undefined}
      style={{
        padding: view === "custom" ? 8 : 6,
        borderRadius: 8,
      }}
    >
      {view === "presets" ? (
        <div
          role={forceMobileSheet ? "menu" : undefined}
          aria-label={forceMobileSheet ? "Snooze until" : undefined}
          onKeyDown={handlePresetKeyDown}
          style={{ padding: forceMobileSheet ? "8px 12px 12px" : undefined }}
        >
          {!forceMobileSheet && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 10, color: "var(--color-text-faint)",
                textTransform: "uppercase", letterSpacing: 0.5,
              }}
            >
              Snooze until
            </div>
          )}
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              role="menuitem"
              className="inbox-snooze-menu-item"
              onClick={() => handlePick(p.at)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", minHeight: forceMobileSheet ? "var(--sp-touch-min)" : 34, padding: "8px 12px",
                background: "transparent", border: "none", cursor: "pointer",
                color: "rgba(205,214,244,0.85)", fontSize: 12, fontFamily: "inherit",
                borderRadius: 6, textAlign: "left",
              }}
            >
              <span>{p.label}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>
                {new Date(p.at).toLocaleString([], {
                  weekday: "short", hour: "numeric", minute: "2-digit",
                  timeZone: DASHBOARD_TZ,
                })}
              </span>
            </button>
          ))}
          <div
            style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "8px 12px" }}
            role="separator"
          />
          <button
            type="button"
            role="menuitem"
            className="inbox-snooze-menu-item"
            onClick={() => setView("custom")}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", minHeight: forceMobileSheet ? "var(--sp-touch-min)" : 34, padding: "8px 12px",
              background: "transparent", border: "none", cursor: "pointer",
              color: "rgba(205,214,244,0.85)", fontSize: 12, fontFamily: "inherit",
              borderRadius: 6, textAlign: "left",
            }}
          >
            <CalendarClock size={12} color="rgba(205,214,244,0.6)" />
            <span>Pick date &amp; time</span>
          </button>
        </div>
      ) : (
        <CalendarDateTimeView
          nowTick={nowTick}
          onSelect={handlePick}
          onBack={() => setView("presets")}
          confirmLabel="Snooze"
        />
      )}
    </AnchoredFloatingPanel>
  );
}
