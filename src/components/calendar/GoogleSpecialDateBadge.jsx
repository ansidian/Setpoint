import { Cake } from "lucide-react";
import { googleSpecialDateAccent } from "./googleSpecialDateModel.js";

function colorWithAlpha(color, alpha) {
  if (typeof color !== "string" || !color.startsWith("#") || color.length !== 7) return `rgba(255,136,124,${alpha})`;
  const value = Number.parseInt(color.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const SIZE_BY_VARIANT = {
  chip: { badge: 20, icon: 12 },
  span: { badge: 20, icon: 12 },
  agenda: { badge: 22, icon: 13 },
  search: { badge: 22, icon: 13 },
  detail: { badge: 26, icon: 15 },
};

export default function GoogleSpecialDateBadge({
  item,
  color,
  selected = false,
  active = false,
  variant = "chip",
}) {
  const accent = color || googleSpecialDateAccent(item);
  const size = SIZE_BY_VARIANT[variant] || SIZE_BY_VARIANT.chip;
  return (
    <span
      data-calendar-special-date-badge="true"
      aria-hidden="true"
      style={{
        width: size.badge,
        height: size.badge,
        minWidth: size.badge,
        borderRadius: 999,
        display: "inline-grid",
        placeItems: "center",
        alignSelf: "center",
        justifySelf: "center",
        color: "#ffe4df",
        border: `1px solid ${colorWithAlpha(accent, selected ? 0.58 : active ? 0.46 : 0.34)}`,
        background: colorWithAlpha(accent, selected ? 0.28 : active ? 0.22 : 0.16),
        boxShadow: selected || active ? `0 0 10px ${colorWithAlpha(accent, selected ? 0.22 : 0.16)}` : "none",
        pointerEvents: "none",
      }}
    >
      <Cake size={size.icon} strokeWidth={2.2} />
    </span>
  );
}
