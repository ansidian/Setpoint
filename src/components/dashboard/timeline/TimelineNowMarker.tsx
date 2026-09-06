import { formatNowMarkerClock } from "./timeline-helpers";

/**
 * Standalone "NOW · 12:40" marker shown on the today timeline when the current
 * moment falls in a focus window (a gap between events, with nothing live). When
 * an event is live the in-card progress line in TimelineRow owns the marker
 * instead — the two are mutually exclusive (see resolveTodayNowMarkerIndex).
 */
export default function TimelineNowMarker({ accent, now }: { accent: string; now: number }) {
  return (
    <div
      data-testid="timeline-gap-now-marker"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px 6px", pointerEvents: "none" }}
    >
      <span
        style={{
          fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums",
          color: accent, background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap",
        }}
      >
        NOW · {formatNowMarkerClock(now)}
      </span>
      <span style={{ flex: 1, height: 1, background: `color-mix(in srgb, ${accent} 25%, transparent)` }} />
    </div>
  );
}
