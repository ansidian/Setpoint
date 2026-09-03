import { useState } from "react";
import Tooltip from "../../shared/Tooltip";
import { TimelineClock } from "./TimelineClock";
import type { ReactNode } from "react";
import type { TimelineFilters } from "./timeline-helpers";

function SectionHeader({ title, right }: { title: ReactNode; right: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 2.2,
          textTransform: "uppercase",
          color: "var(--color-text-faint)",
        }}
      >
        {title}
      </div>
      {right}
    </div>
  );
}

function TimelineRefreshStatus({ accent }: { accent: string }) {
  return (
    <div
      data-testid="timeline-refresh-status"
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "3px 8px",
        borderRadius: 9999,
        border: `1px solid ${accent}38`,
        background: `${accent}14`,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.25,
        color: "var(--sp-text)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: accent,
          boxShadow: `0 0 6px ${accent}70`,
          animation: "dashPulse 1.8s ease-in-out infinite",
        }}
      />
      Updating timeline
    </div>
  );
}

function TimelineFilterChip({ active, accent, isMobile = false, label, onToggle }: {
  active: boolean;
  accent: string;
  isMobile?: boolean;
  label: string;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const highlighted = hover || focus;
  const background = active
    ? `${accent}1f`
    : highlighted
      ? "rgba(255,255,255,0.035)"
      : "transparent";
  const borderColor = active
    ? `${accent}38`
    : highlighted
      ? "rgba(255,255,255,0.08)"
      : "transparent";
  const color = active
    ? accent
    : highlighted
      ? "rgba(205,214,244,0.82)"
      : "var(--color-text-faint)";
  const dotBorder = active
    ? accent
    : highlighted
      ? "rgba(205,214,244,0.55)"
      : "rgba(205,214,244,0.35)";
  const dotBackground = active
    ? accent
    : highlighted
      ? "rgba(205,214,244,0.16)"
      : "transparent";

  return (
    <button
      type="button"
      className={isMobile ? "timeline-mobile-control" : undefined}
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        minHeight: isMobile ? 44 : undefined,
        padding: isMobile ? "8px 12px" : "4px 10px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: isMobile ? 10 : 10.5,
        fontFamily: "inherit",
        letterSpacing: 0.2,
        background,
        border: `1px solid ${borderColor}`,
        color,
        transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: dotBackground,
          border: `1px solid ${dotBorder}`,
          boxShadow: active ? `0 0 6px ${accent}80` : "none",
          transition: "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
        }}
      />
      {label}
    </button>
  );
}

export default function TimelineHeader({
  accent,
  filters,
  isMobile = false,
  now,
  onToggleFilter,
  showRefreshStatus = false,
  todayLabel,
}: {
  accent: string;
  filters: TimelineFilters;
  isMobile?: boolean;
  now?: number;
  onToggleFilter: (filter: keyof TimelineFilters) => void;
  showRefreshStatus?: boolean;
  todayLabel?: string;
}) {
  if (isMobile) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--sp-text)" }}>Today</h2>
          {typeof now === "number" && <TimelineClock now={now} />}
        </div>
        <div role="group" aria-label="Timeline filters" style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <TimelineFilterChip active={filters.events} accent={accent} isMobile label="Events" onToggle={() => onToggleFilter("events")} />
          <TimelineFilterChip active={filters.deadlines} accent={accent} isMobile label="Deadlines" onToggle={() => onToggleFilter("deadlines")} />
          {showRefreshStatus && <TimelineRefreshStatus accent={accent} />}
        </div>
      </div>
    );
  }

  return (
    <SectionHeader
      title={(
        <Tooltip text={todayLabel} sideOffset={12}>
          <span>Today</span>
        </Tooltip>
      )}
      right={(
        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "flex-start" : "center",
            gap: isMobile ? 6 : 10,
            justifyContent: isMobile ? "flex-start" : "flex-end",
          }}
        >
          {typeof now === "number" && <TimelineClock now={now} />}
          {showRefreshStatus && <TimelineRefreshStatus accent={accent} />}
          <div
            role="group"
            aria-label="Timeline filters"
            style={{
              display: "flex",
              flexWrap: isMobile ? "wrap" : "nowrap",
              gap: 2,
              padding: 2,
              borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
              justifyContent: isMobile ? "flex-start" : "flex-end",
              maxWidth: isMobile ? "100%" : "none",
            }}
          >
            {([
              { id: "events", label: "Events" },
              { id: "deadlines", label: "Deadlines" },
            ] as const).map((filter) => (
              <TimelineFilterChip
                key={filter.id}
                active={!!filters[filter.id]}
                accent={accent}
                isMobile={isMobile}
                label={filter.label}
                onToggle={() => onToggleFilter(filter.id)}
              />
            ))}
          </div>
        </div>
      )}
    />
  );
}
