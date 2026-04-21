export const ACCENT = "var(--ea-accent)";

export function toPacificYmd(epoch) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epoch));
}

export function formatDateLabel(value) {
  if (!value) return "Choose date";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimeLabel(value) {
  if (!value) return "Choose time";
  return new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function addMinutesToDraftDateTime(dateValue, timeValue, minutesToAdd) {
  const baseDate = dateValue || "2026-01-01";
  const baseTime = timeValue || "09:00";
  const [hour, minute] = baseTime.split(":").map(Number);
  const base = new Date(`${baseDate}T00:00:00`);
  base.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  base.setMinutes(base.getMinutes() + minutesToAdd);
  const nextDate = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
  const nextTime = `${String(base.getHours()).padStart(2, "0")}:${String(base.getMinutes()).padStart(2, "0")}`;
  return { date: nextDate, time: nextTime };
}

export function sourceDotStyle(color) {
  return {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: color || "#4285f4",
    boxShadow: `0 0 0 1px ${color || "#4285f4"}22, 0 0 8px ${color || "#4285f4"}44`,
    flexShrink: 0,
  };
}

export function textFieldStyle({ invalid = false } = {}) {
  return {
    width: "100%",
    background: "rgba(255,255,255,0.03)",
    border: invalid
      ? "1px solid rgba(249, 115, 22, 0.42)"
      : "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#cdd6f4",
    fontSize: 12.5,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
}
