import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFullDate } from "./calendarOverviewModel.js";
import { heroCardStyle } from "./calendarRailStyles.js";

export function OverviewHero({ model, compact = false }) {
  const Icon = model.icon;

  return (
    <div style={heroCardStyle(model.accent)}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 0.8px, transparent 0.8px)",
          backgroundSize: "20px 20px",
          opacity: 0.18,
          maskImage: "linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.3))",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: compact ? "16px 16px 14px" : "18px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: compact ? 10 : 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2.4,
              textTransform: "uppercase",
              color: "var(--color-text-faint)",
            }}
          >
            {model.eyebrow}
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              background: `color-mix(in srgb, ${model.accent} 14%, rgba(255,255,255,0.03))`,
              border: `1px solid color-mix(in srgb, ${model.accent} 20%, rgba(255,255,255,0.04))`,
              color: model.accent,
              boxShadow: `0 0 14px color-mix(in srgb, ${model.accent} 14%, transparent)`,
            }}
          >
            <Icon size={15} strokeWidth={1.9} />
          </div>
        </div>

        <div
          className="ea-display"
          style={{
            fontSize: compact ? 22 : 24,
            lineHeight: 1.02,
            letterSpacing: compact ? -0.38 : -0.45,
            color: "#f5f7ff",
          }}
        >
          {model.title}
        </div>

        <div
          style={{
            fontSize: 12.5,
            lineHeight: compact ? 1.54 : 1.62,
            color: "rgba(205,214,244,0.62)",
            ...(compact
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
              : {}),
          }}
        >
          {model.description}
        </div>
      </div>
    </div>
  );
}

export function SpotlightCard({ accent, label, value, detail, compact = false }) {
  return (
    <div
      style={{
        gridColumn: "1 / -1",
        padding: compact ? "14px 14px 12px" : "16px 16px 14px",
        borderRadius: 14,
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 9%, rgba(255,255,255,0.025)), rgba(255,255,255,0.02))`,
        border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.05))`,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: "var(--color-text-faint)" }}>
        {label}
      </div>
      <div
        className="ea-display"
        style={{
          marginTop: 8,
          fontSize: compact ? 24 : 28,
          lineHeight: 1,
          letterSpacing: compact ? -0.42 : -0.55,
          color: "#fff",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11.5,
          lineHeight: compact ? 1.48 : 1.55,
          color: "rgba(205,214,244,0.56)",
          ...(compact
            ? {
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : {}),
        }}
      >
        {detail}
      </div>
    </div>
  );
}

export function MetricCard({ label, value, detail, accent, compact = false }) {
  return (
    <div
      style={{
        padding: compact ? "11px 12px 10px" : "13px 14px 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.018)",
        border: "1px solid rgba(255,255,255,0.05)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--color-text-faint)" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: compact ? 7 : 8,
          fontSize: compact ? 18 : 20,
          fontWeight: 500,
          lineHeight: 1,
          color: accent,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: compact ? 7 : 8,
          fontSize: 11,
          lineHeight: compact ? 1.42 : 1.5,
          color: "var(--color-text-faint)",
          ...(compact
            ? {
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : {}),
        }}
      >
        {detail}
      </div>
    </div>
  );
}

export function FooterFrame({ label, children }) {
  if (!children) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.9, textTransform: "uppercase", color: "var(--color-text-faint)" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function EventsLoadingFrame() {
  return (
    <div
      data-testid="calendar-events-rail-skeleton"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        borderRadius: 14,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
        flexShrink: 0,
      }}
    >
      <Skeleton className="h-[11px] w-[128px] bg-white/8" />
      <Skeleton className="h-[22px] w-[212px] bg-white/10" />
      <Skeleton className="h-[12px] w-full bg-white/7" />
      <Skeleton className="h-[12px] w-[88%] bg-white/7" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 4 }}>
        <Skeleton className="h-[92px] w-full rounded-[12px] bg-white/7" />
        <Skeleton className="h-[92px] w-full rounded-[12px] bg-white/7" />
      </div>
    </div>
  );
}

export function EmptyDayPrimaryAction({ action }) {
  const [hovered, setHovered] = useState(false);
  if (!action) return null;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(203,166,218,0.16)",
        background: "rgba(203,166,218,0.055)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={action.onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-calendar-focus-ring="true"
        style={{
          alignSelf: "flex-start",
          padding: "8px 12px",
          borderRadius: 8,
          border: hovered ? "1px solid rgba(203,166,218,0.38)" : "1px solid rgba(203,166,218,0.24)",
          background: hovered ? "rgba(203,166,218,0.18)" : "rgba(203,166,218,0.12)",
          color: "#cba6da",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: "pointer",
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
          transition: "background 140ms, border-color 140ms, transform 140ms",
        }}
      >
        {action.label}
      </button>
      <div style={{ fontSize: 11, lineHeight: 1.45, color: "rgba(205,214,244,0.56)" }}>
        {action.detail}
      </div>
    </div>
  );
}

export function EmptyDayCard({ model, viewYear, viewMonth, selectedDay, compact = false }) {
  const Icon = model.icon;

  return (
    <div
      data-testid="calendar-selected-empty-rail"
      style={{
        ...heroCardStyle(model.accent),
        padding: compact ? 12 : 14,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 0.8px, transparent 0.8px)",
          backgroundSize: "20px 20px",
          opacity: 0.16,
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          gap: compact ? 8 : 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: compact ? 10 : 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background: model.accent,
                boxShadow: `0 0 8px color-mix(in srgb, ${model.accent} 34%, transparent)`,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 5, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.2, textTransform: "uppercase", color: "var(--color-text-faint)" }}>
                {model.selectedDayLabel}
              </div>
              <div style={{ fontSize: compact ? 10.5 : 11, lineHeight: 1.25, color: "rgba(205,214,244,0.58)" }}>
                {model.emptyDayLabel}
              </div>
            </div>
          </div>
          <div
            style={{
              width: compact ? 30 : 34,
              height: compact ? 30 : 34,
              borderRadius: compact ? 10 : 12,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              background: `color-mix(in srgb, ${model.accent} 14%, rgba(255,255,255,0.03))`,
              border: `1px solid color-mix(in srgb, ${model.accent} 20%, rgba(255,255,255,0.04))`,
              color: model.accent,
            }}
          >
            <Icon size={compact ? 13 : 15} strokeWidth={1.9} />
          </div>
        </div>

        <div className="ea-display" style={{ fontSize: compact ? 18 : 21, lineHeight: 1.04, letterSpacing: compact ? -0.28 : -0.34, color: "#fff" }}>
          {formatFullDate(viewYear, viewMonth, selectedDay)}
        </div>

        <div
          style={{
            maxWidth: compact ? "100%" : 260,
            fontSize: compact ? 11 : 12,
            lineHeight: 1.46,
            color: "rgba(205,214,244,0.62)",
            ...(compact
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
              : {}),
          }}
        >
          {model.railDescription}
        </div>
      </div>
    </div>
  );
}
