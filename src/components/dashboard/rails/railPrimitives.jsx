import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  Flag,
} from "lucide-react";
import { daysLabel, urgencyForDays } from "../../../lib/shell-helpers";
import { PRIORITY_COLOR } from "./railModel.js";

export function SectionHeader({ title, subtitle, right, isMobile = false }) {
  return (
    <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", justifyContent: "space-between", gap: 10, flexWrap: isMobile ? "wrap" : "nowrap" }}>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase",
            color: "rgba(205,214,244,0.55)",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "rgba(205,214,244,0.4)", marginTop: 3 }}>{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  );
}

function verboseDaysLabel(days) {
  if (days == null || Number.isNaN(days)) return "No due date";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) {
    const count = Math.abs(days);
    return `${count} ${count === 1 ? "day" : "days"} overdue`;
  }
  return `In ${days} days`;
}

export function UrgencyPill({ days, accent, compact, verbose = false }) {
  const u = urgencyForDays(days, accent).key;
  const color = u === "high" ? "#f38ba8" : u === "medium" ? "#f9e2af" : accent;
  return (
    <div
      style={{
        fontSize: compact ? 9.5 : 10, fontWeight: 600,
        padding: "2px 7px", borderRadius: 99,
        background: `${color}22`, color, letterSpacing: 0.2,
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      }}
    >
      {verbose ? verboseDaysLabel(days) : daysLabel(days)}
    </div>
  );
}

export function OpenInboxButton({ accent, onClick }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const active = hover || focus;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        padding: "3px 8px",
        borderRadius: 6,
        border: `1px solid ${active ? `${accent}3f` : "rgba(255,255,255,0.08)"}`,
        background: active ? `${accent}14` : "rgba(255,255,255,0.015)",
        color: active ? accent : "rgba(205,214,244,0.7)",
        fontSize: 10,
        fontFamily: "inherit",
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
      }}
    >
      <span>Open</span>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          transform: active ? "translateX(1.5px)" : "translateX(0)",
          transition: "transform 140ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <ArrowRight size={9} />
      </span>
    </button>
  );
}

export function DeadlineStatusIcon({ status, size = 12 }) {
  if (status === "complete") return <CheckCircle2 size={size} color="#a6e3a1" />;
  if (status === "in_progress") return <CircleDashed size={size} color="#89dceb" />;
  return <Circle size={size} color="rgba(205,214,244,0.45)" />;
}

export function PriorityFlag({ level, size = 11 }) {
  const color = PRIORITY_COLOR[level];
  if (!color) return null;
  return (
    <span
      title={`P${level}`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size + 4, height: size + 4, borderRadius: 4,
        background: `${color}1e`, border: `1px solid ${color}38`,
        flexShrink: 0,
      }}
    >
      <Flag size={size - 2} color={color} strokeWidth={2.2} />
    </span>
  );
}

export function CountBadge({ n }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 500, padding: "1px 7px", borderRadius: 99,
        background: "rgba(255,255,255,0.05)", color: "rgba(205,214,244,0.6)",
      }}
    >
      {n}
    </div>
  );
}

export function RailGroupLabel({ label, count, tone = "default" }) {
  const color = tone === "success" ? "#a6e3a1" : "rgba(205,214,244,0.58)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "rgba(205,214,244,0.38)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </div>
    </div>
  );
}

export function EmptyRow({ icon, label }) {
  const Icon = icon;
  return (
    <div
      style={{
        padding: "20px 14px", textAlign: "center",
        fontSize: 11.5, color: "rgba(205,214,244,0.4)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      }}
    >
      <Icon size={16} color="rgba(205,214,244,0.25)" />
      {label}
    </div>
  );
}
