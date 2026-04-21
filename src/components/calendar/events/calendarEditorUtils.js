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

export const RECURRING_SCOPE_OPTIONS = [
  { value: "all", label: "All events", description: "Update the whole series." },
  { value: "following", label: "Upcoming only", description: "Update this event and future ones." },
  { value: "one", label: "Just this one", description: "Create an exception for only this event." },
];

export function recurringScopeLabel(scope) {
  return RECURRING_SCOPE_OPTIONS.find((option) => option.value === scope)?.label || "";
}

export const WEEKDAY_OPTIONS = [
  { code: "SU", label: "Sun" },
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
];

const WEEKDAY_LABEL_MAP = Object.fromEntries(WEEKDAY_OPTIONS.map((o) => [o.code, o.label]));

function ordinalSuffix(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

export function formatMonthDay(dateStr) {
  if (!dateStr) return "the selected day";
  const date = new Date(`${dateStr}T12:00:00Z`);
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
  });
}

export function formatRecurrenceSummary(recurrenceDraft, startDate) {
  if (!recurrenceDraft) return "";
  const { frequency, interval, weekdays } = recurrenceDraft;
  const intervalLabel = interval > 1 ? `${interval} ` : "";

  if (frequency === "daily") {
    return interval > 1 ? `Every ${interval} days` : "Every day";
  }
  if (frequency === "weekly") {
    const dayLabels = (weekdays || []).map((code) => WEEKDAY_LABEL_MAP[code] || code);
    const dayList = dayLabels.length ? dayLabels.join(", ") : "";
    if (interval === 1) {
      return dayList ? `Every ${dayList}` : "Every week";
    }
    return dayList
      ? `Every ${intervalLabel}weeks on ${dayList}`
      : `Every ${interval} weeks`;
  }
  if (frequency === "monthly") {
    const dayNum = startDate ? Number(startDate.slice(-2)) : null;
    const anchor = dayNum ? ` on the ${dayNum}${ordinalSuffix(dayNum)}` : "";
    return interval > 1 ? `Every ${interval} months${anchor}` : `Monthly${anchor}`;
  }
  if (frequency === "yearly") {
    const anchor = startDate ? ` on ${formatMonthDay(startDate)}` : "";
    return interval > 1 ? `Every ${interval} years${anchor}` : `Yearly${anchor}`;
  }
  return "";
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
