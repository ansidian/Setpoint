import { googleEventColorIdForSourceHex } from "../../../../shared/calendar-event-colors.js";

// Pure color resolution for the calendar quick-action color grid. Extracted from
// CalendarQuickActionLayer so the colorId fallback chain and the check-icon
// contrast rule are unit-testable in isolation.

function normalizedHex(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Resolve which palette colorId an event currently shows: an explicit colorId or
// sourceColorId wins; otherwise map the visible/source hex back to a palette id.
export function selectedEventColorId(event) {
  if (event?.colorId) return String(event.colorId);
  if (event?.sourceColorId) return String(event.sourceColorId);
  const visibleColor = normalizedHex(event?.color || event?.sourceColor);
  if (!visibleColor) return null;
  return googleEventColorIdForSourceHex(visibleColor);
}

// Pick a check-icon color with enough contrast against the dot's fill.
export function checkColorForDot(hex) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#f8f5ff";
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#16161e" : "#f8f5ff";
}
