/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";

export function CompactBandAction({ label, onClick, color, tone }) {
  const [hovered, setHovered] = useState(false);
  const isSuccess = tone === "success";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "2px 6px",
        border: "none",
        borderRadius: 4,
        background: hovered
          ? isSuccess ? "rgba(166,227,161,0.12)" : "rgba(255,255,255,0.06)"
          : "transparent",
        fontSize: 10,
        fontWeight: 600,
        color,
        cursor: "pointer",
        letterSpacing: 0.5,
        opacity: hovered ? 1 : 0.78,
        transition: "opacity 140ms, background 140ms",
      }}
    >
      {label}
    </button>
  );
}

export function compactPanelStyle(accent = "rgba(255,255,255,0.05)", emphasis = false) {
  return {
    padding: emphasis ? "8px 10px" : "7px 9px",
    borderRadius: 14,
    border: emphasis
      ? `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.05))`
      : "1px solid rgba(255,255,255,0.05)",
    background: emphasis
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, rgba(255,255,255,0.028)), rgba(255,255,255,0.018))`
      : "rgba(255,255,255,0.018)",
    boxShadow: emphasis
      ? `inset 0 1px 0 color-mix(in srgb, ${accent} 12%, rgba(255,255,255,0.03))`
      : "inset 0 1px 0 rgba(255,255,255,0.03)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    justifyContent: "space-between",
    minWidth: 0,
  };
}

export function compactEyebrowStyle() {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "rgba(205,214,244,0.44)",
  };
}

export function compactValueStyle(color = "#fff", size = 18) {
  return {
    fontSize: size,
    lineHeight: 1.02,
    letterSpacing: -0.28,
    color,
  };
}

export function compactDetailStyle() {
  return {
    fontSize: 11,
    lineHeight: 1.4,
    color: "rgba(205,214,244,0.56)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

export function compactMetricRowStyle() {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "baseline",
    minWidth: 0,
  };
}

export function nearestBusyDay(itemsByDay, selectedDay, viewYear, viewMonth) {
  const days = Object.keys(itemsByDay || {})
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  let closest = null;
  for (const day of days) {
    if (day === selectedDay) continue;
    const count = Array.isArray(itemsByDay?.[day]) ? itemsByDay[day].length : itemsByDay?.[day]?.totalCount || 0;
    if (!count) continue;
    const distance = Math.abs(day - selectedDay);
    if (!closest || distance < closest.distance || (distance === closest.distance && day < closest.day)) {
      closest = { day, distance, count };
    }
  }

  if (!closest) return null;

  return {
    ...closest,
    label: new Date(viewYear, viewMonth, closest.day).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    direction: closest.day < selectedDay ? "earlier" : "later",
  };
}
