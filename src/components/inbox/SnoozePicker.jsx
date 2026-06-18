import { useState, useRef, useEffect } from "react";
import { CalendarClock } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import {
  buildSnoozePresets,
  DASHBOARD_TZ,
} from "./helpers";

export function CustomDateTimeView(props) {
  return <CalendarDateTimeView confirmLabel="Snooze" {...props} />;
}

// Floating picker anchored to the Snooze button. Follows the project's
// "Floating Panel Pattern" — portal, fixed positioning, isolated stacking,
// click-outside dismiss, and wheel-boundary capture so scroll inside the
// picker can't leak to the page.
export default function SnoozePicker({ anchorRef, onSelect, onClose }) {
  const panelRef = useRef(null);
  // View state: "presets" shows quick-picks, "custom" shows the calendar +
  // time view. Swapping views changes panel dimensions, so the placement
  // effect re-runs (view is in its dep array) to keep overflow handling sound.
  const [view, setView] = useState("presets");
  // nowTick drives live-updating preview text on "+6h" / "+24h" rows so the
  // labels stay accurate while the picker sits open. 60s cadence is coarse
  // enough to avoid needless renders and fine enough to feel fresh.
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const presets = buildSnoozePresets(nowTick);
  const panelW = view === "custom" ? 300 : 240;
  const panelH = view === "custom" ? 400 : 180;

  const handlePick = (ts) => { onSelect(ts); onClose(); };

  return (
    <AnchoredFloatingPanel
      anchorRef={anchorRef}
      panelRef={panelRef}
      onClose={onClose}
      width={panelW}
      height={panelH}
      role="menu"
      style={{
        padding: view === "custom" ? 8 : 6,
        borderRadius: 8,
      }}
    >
      {view === "presets" ? (
        <>
          <div
            style={{
              padding: "6px 10px 8px",
              fontSize: 10, color: "var(--color-text-faint)",
              textTransform: "uppercase", letterSpacing: 0.5,
            }}
          >
            Snooze until
          </div>
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => handlePick(p.at)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", padding: "8px 10px",
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
            style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "6px 8px" }}
            role="separator"
          />
          <button
            type="button"
            onClick={() => setView("custom")}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "8px 10px",
              background: "transparent", border: "none", cursor: "pointer",
              color: "rgba(205,214,244,0.85)", fontSize: 12, fontFamily: "inherit",
              borderRadius: 6, textAlign: "left",
            }}
          >
            <CalendarClock size={12} color="rgba(205,214,244,0.6)" />
            <span>Pick date &amp; time</span>
          </button>
        </>
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
