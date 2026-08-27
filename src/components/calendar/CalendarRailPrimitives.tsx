import { useState } from "react";
import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFullDate } from "./calendarOverviewModel.ts";
import { heroCardStyle } from "./calendarRailStyles.ts";

interface RailModel { icon: ComponentType<{ size?: number; strokeWidth?: number }>; accent: string; eyebrow?: string; title?: string; description?: string; selectedDayLabel?: string; emptyDayLabel?: string; railDescription?: string }
interface MetricProps { accent: string; label: string; value: string; detail: string; compact?: boolean }
interface PrimaryAction { label: string; detail: string; onClick: () => void }

export function MetricCard({ label, value, detail, accent, compact = false }: MetricProps) {
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

export function EmptyDayPrimaryAction({ action }: { action?: PrimaryAction | null }) {
  const [hovered, setHovered] = useState(false);
  if (!action) return null;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid color-mix(in srgb, var(--sp-accent) 16%, transparent)",
        background: "color-mix(in srgb, var(--sp-accent) 6%, transparent)",
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
          border: hovered ? "1px solid color-mix(in srgb, var(--sp-accent) 38%, transparent)" : "1px solid color-mix(in srgb, var(--sp-accent) 24%, transparent)",
          background: hovered ? "color-mix(in srgb, var(--sp-accent) 18%, transparent)" : "color-mix(in srgb, var(--sp-accent) 12%, transparent)",
          color: "var(--sp-accent)",
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

export function EmptyDayCard({ model, viewYear, viewMonth, selectedDay, compact = false }: { model: RailModel; viewYear: number; viewMonth: number; selectedDay: number; compact?: boolean }) {
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
          backgroundImage: "radial-gradient(var(--sp-dot) 0.5px, transparent 0.5px)",
          backgroundSize: "10px 10px",
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

        <div style={{ fontSize: compact ? 18 : 21, fontWeight: 600, lineHeight: 1.04, letterSpacing: compact ? -0.28 : -0.34, color: "#fff" }}>
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
