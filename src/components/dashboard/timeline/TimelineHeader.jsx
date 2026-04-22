import { useState } from "react";
import Tooltip from "../../shared/Tooltip";

function SectionHeader({ title, right }) {
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
          color: "rgba(205,214,244,0.55)",
        }}
      >
        {title}
      </div>
      {right}
    </div>
  );
}

function TimelineRefreshStatus({ accent }) {
  return (
    <div
      data-testid="timeline-refresh-status"
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
        color: "#cdd6f4",
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
      Updating Google Calendar
    </div>
  );
}

function TimelineFilterChip({ active, accent, isMobile = false, label, onToggle }) {
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
      : "rgba(205,214,244,0.5)";
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
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        padding: isMobile ? "6px 9px" : "4px 10px",
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
  onToggleFilter,
  showRefreshStatus = false,
  todayLabel,
}) {
  return (
    <SectionHeader
      title={(
        <Tooltip text={todayLabel} sideOffset={12}>
          <span>Timeline</span>
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
            {[
              { id: "events", label: "Events" },
              { id: "deadlines", label: "Deadlines" },
            ].map((filter) => (
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
