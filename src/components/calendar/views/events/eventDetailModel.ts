import { formatEventDuration, getEventSelectionId } from "../../../../lib/shell-helpers";
import { getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { parseYmd } from "../../calendarDateUtils.ts";
import {
  googleSpecialDateAccent,
  googleSpecialDateLabel,
  isGoogleSpecialDateEvent,
} from "../../googleSpecialDateModel.ts";
import type { CalendarItemLike } from "../calendarViewTypes";
import { isDeadlinePlanningItem, orderPlanningItems } from "./eventsPlanningModel.ts";

// Pure event-detail transforms shared by EventSelectedCard, the events detail
// rail, and the dashboard glance sheet. No React here — leaf model so nothing
// imports back into a cycle and tests can hit it directly.

const PACIFIC_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function orderDetailEvents(items: CalendarItemLike[] = []): CalendarItemLike[] {
  if (items.some(isDeadlinePlanningItem)) return orderPlanningItems([...items]);
  return [...items].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMs || 0) - (b.startMs || 0);
  });
}

export function getDefaultSelectedItemId(items: CalendarItemLike[] | { items?: CalendarItemLike[] } = []): string | null {
  const ordered = orderDetailEvents(Array.isArray(items) ? items : items?.items || []);
  return ordered[0] ? getEventSelectionId(ordered[0]) : null;
}

export function pacificTime(ms: number): string {
  return PACIFIC_TIME_FORMATTER.format(new Date(ms));
}

function eventTimeRange(ev: CalendarItemLike): string {
  if (ev?.allDay) return ev.duration || "All day";
  const start = ev?.startMs ? pacificTime(ev.startMs) : null;
  const end = ev?.endMs ? pacificTime(ev.endMs) : null;
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end || eventMeta(ev) || "";
}

function condenseLocationLabel(text: string, maxLength = 56): string {
  const label = getLocationDisplayLabel(text);
  if (!label || label.length <= maxLength || label === "Zoom meeting") return label;
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return label;

  const firstTwo = parts.slice(0, 2).join(", ");
  if (firstTwo.length <= maxLength) return firstTwo;
  return parts[0] || label;
}

export function compactEventTimeRange(ev: CalendarItemLike): string {
  if (ev?.allDay) return ev.duration || "All day";
  const start = ev?.startMs ? pacificTime(ev.startMs) : null;
  const end = ev?.endMs ? pacificTime(ev.endMs) : null;
  if (!start || !end || start === end) return eventTimeRange(ev);

  const startMatch = start.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/);
  const endMatch = end.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/);
  if (!startMatch || !endMatch) return `${start} - ${end}`;

  const [, startTime, startMeridiem] = startMatch;
  const [, endTime, endMeridiem] = endMatch;
  if (startMeridiem === endMeridiem) return `${startTime}-${endTime} ${endMeridiem}`;
  return `${startTime} ${startMeridiem}-${endTime} ${endMeridiem}`;
}

export function formatFullDate(year: number, month: number, day: number, selectedDateKey?: string | null): string {
  const parsed = parseYmd(selectedDateKey);
  if (parsed) return FULL_DATE_FORMATTER.format(new Date(parsed.year, parsed.month, parsed.day));
  return FULL_DATE_FORMATTER.format(new Date(year, month, day));
}

export function eventSubtitle(ev: CalendarItemLike): string {
  if (ev.attendees?.length) {
    return `with ${ev.attendees.slice(0, 3).join(", ")}${ev.attendees.length > 3 ? ` +${ev.attendees.length - 3}` : ""}`;
  }
  if (ev.location) return condenseLocationLabel(ev.location, 40);
  return ev.subtitle || "";
}

export function eventMeta(ev: CalendarItemLike): string {
  if (ev.allDay) return ev.duration || "All day";
  return formatEventDuration(ev.startMs, ev.endMs) || ev.duration || "";
}

export function specialEventLabel(ev: CalendarItemLike): string | null {
  if (isGoogleSpecialDateEvent(ev)) return googleSpecialDateLabel(ev);
  const eventType = ev?.eventType || "default";
  if (eventType === "fromGmail") return "From Gmail";
  if (eventType === "focusTime") return "Focus time";
  if (eventType === "outOfOffice") return "Out of office";
  if (eventType === "workingLocation") return "Working location";
  return null;
}

export function isEditableEvent(ev: CalendarItemLike): boolean {
  return !!ev?.writable && (ev.eventType || "default") === "default";
}

function isReadOnlyBirthdayEvent(ev: CalendarItemLike): boolean {
  return isGoogleSpecialDateEvent(ev);
}

export function calendarActionUrl(ev: CalendarItemLike): string | null {
  if (isReadOnlyBirthdayEvent(ev)) return null;
  return ev?.openUrl || ev?.htmlLink || null;
}

export function eventAccent(ev: CalendarItemLike): string {
  if (isGoogleSpecialDateEvent(ev)) return googleSpecialDateAccent(ev);
  return ev?.color || ev?.sourceColor || "#89b4fa";
}
