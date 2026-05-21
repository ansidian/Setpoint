import { useState } from "react";
import { Bell } from "lucide-react";
import { formatReminderSummary } from "../../calendar/reminderDisplay.js";

export default function HeroCalloutCard({
  accent,
  icon,
  isMobile = false,
  kind,
  lead,
  onJump,
  sub,
  title,
  urgency,
  data,
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const Icon = icon;
  const colors = {
    high: "#f38ba8",
    medium: "#f9e2af",
    low: accent,
  };
  const tone = colors[urgency] || colors.low;
  const kindLabel = { event: "Next up", deadline: "Deadline", bill: "Payment" }[kind] || "";
  const active = hovered || focused;
  const reminderSummary = formatReminderSummary(data);

  return (
    <button
      type="button"
      data-testid={`hero-callout-${kind}`}
      onClick={(e) => onJump?.(e.currentTarget)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: "100%",
        minWidth: 0,
        padding: isMobile ? "12px 0" : "3px 0",
        borderRadius: 8,
        background: active ? "rgba(255,255,255,0.03)" : "transparent",
        border: 0,
        outline: focused ? `2px solid ${accent}` : "none",
        outlineOffset: 3,
        color: "inherit",
        fontFamily: "inherit",
        textAlign: "left",
        cursor: "pointer",
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 10 : 12,
        transition: "background 150ms ease, transform 180ms cubic-bezier(0.22,1,0.36,1)",
        transform: active && !isMobile ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
        <div
          style={{
            width: isMobile ? 22 : 22,
            height: isMobile ? 22 : 22,
            borderRadius: 6,
            background: `${tone}12`,
            border: `1px solid ${tone}26`,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={isMobile ? 10 : 10} color={tone} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div
              style={{
                fontSize: isMobile ? 9 : 9.5,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "rgba(205,214,244,0.45)",
                whiteSpace: "nowrap",
              }}
            >
              {kindLabel}
            </div>
            <div style={{ height: 3, width: 3, borderRadius: 99, background: tone, opacity: 0.75, flexShrink: 0 }} />
            <div
              style={{
                fontSize: isMobile ? 10 : 10,
                fontWeight: 600,
                letterSpacing: 0.2,
                color: tone,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {lead}
            </div>
            {reminderSummary ? (
              <div
                data-testid="dashboard-reminder-indicator"
                aria-label={reminderSummary}
                title={reminderSummary}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 0,
                  maxWidth: isMobile ? "100%" : 168,
                  padding: "1px 6px",
                  borderRadius: 999,
                  border: "1px solid rgba(249,226,175,0.26)",
                  background: "rgba(249,226,175,0.10)",
                  color: "#f9e2af",
                  fontSize: isMobile ? 9.5 : 10,
                  fontWeight: 650,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                  flexShrink: 1,
                }}
              >
                <Bell size={10} aria-hidden />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {reminderSummary}
                </span>
              </div>
            ) : null}
          </div>

          <div
            style={{
              fontSize: isMobile ? 13 : 12.5,
              fontWeight: 500,
              color: "#cdd6f4",
              lineHeight: 1.35,
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          {sub && (
            <div
              style={{
                fontSize: isMobile ? 11 : 10.5,
                color: "rgba(205,214,244,0.55)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginTop: 2,
              }}
            >
              {sub}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
