import { normalizeStatus } from "../calendar/views/deadlines/deadlinesModel";
import { calendarActionUrl } from "../calendar/views/events/eventDetailModel";
import { extractNonZoomEventUrl, extractZoomMeetingUrl } from "../../lib/calendar-links";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import type { TodoistTask } from "../../../shared/types/tasks";

export type GlanceKind = "deadline" | "event";
export type GlanceActionKey = "complete" | "edit" | "todoist" | "zoom" | "eventUrl" | "gcal" | "openInCalendar";
export interface GlanceAction {
  key: GlanceActionKey;
  label: string;
  type: "command" | "link";
  tone: "success" | "ghost" | "accent";
  href?: string;
}

type DashboardGlanceDeadline = Partial<TodoistTask> & { status?: string };
type DashboardGlanceEvent = Partial<NormalizedCalendarEvent>;

// Ordered action descriptors for the dashboard glance sheet's action row, by item
// kind. Link actions carry an href; command actions ("complete"/"edit"/
// "openInCalendar") are wired to handlers by the sheet. Event editing stays in
// the sheet; deadline deep-links remain explicit. Pure — no React, no handlers.

function openInCalendarAction(): GlanceAction {
  return { key: "openInCalendar", label: "Open in calendar", type: "command", tone: "ghost" };
}

function deadlineActions(task: DashboardGlanceDeadline): GlanceAction[] {
  const out: GlanceAction[] = [];
  if (normalizeStatus(task.status) !== "complete") {
    out.push({ key: "complete", label: "Mark complete", type: "command", tone: "success" });
  }
  out.push({ key: "edit", label: "Edit", type: "command", tone: "ghost" });
  const todoistUrl = task.url && /todoist/i.test(task.url) ? task.url : null;
  if (todoistUrl) {
    out.push({ key: "todoist", label: "Open in Todoist", type: "link", href: todoistUrl, tone: "ghost" });
  }
  out.push(openInCalendarAction());
  return out;
}

function eventActions(ev: DashboardGlanceEvent): GlanceAction[] {
  const out: GlanceAction[] = ev.writable
    ? [{ key: "edit", label: "Edit Event", type: "command", tone: "ghost" }]
    : [];
  const gcalUrl = calendarActionUrl(ev);
  if (gcalUrl) {
    out.push({ key: "gcal", label: "Open in Google Calendar", type: "link", href: gcalUrl, tone: "ghost" });
  }
  const zoomUrl = extractZoomMeetingUrl(ev);
  if (zoomUrl) {
    out.push({ key: "zoom", label: "Join Zoom", type: "link", href: zoomUrl, tone: "accent" });
  }
  const eventUrl = extractNonZoomEventUrl(ev);
  if (eventUrl) {
    out.push({ key: "eventUrl", label: "Open URL", type: "link", href: eventUrl, tone: "ghost" });
  }
  return out;
}

export function selectGlanceActions({ kind, item }: {
  kind: GlanceKind;
  item: DashboardGlanceDeadline | DashboardGlanceEvent | null;
}): GlanceAction[] {
  if (!item) return [];
  if (kind === "deadline") return deadlineActions(item as DashboardGlanceDeadline);
  if (kind === "event") return eventActions(item as DashboardGlanceEvent);
  return [];
}
