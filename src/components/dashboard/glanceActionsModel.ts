import { normalizeStatus } from "../calendar/views/deadlines/deadlinesModel";
import { getScheduleUrl, payUrlForBill } from "../calendar/views/bills/billsModel";
import { calendarActionUrl } from "../calendar/views/events/eventDetailModel";
import { extractNonZoomEventUrl, extractZoomMeetingUrl } from "../../lib/calendar-links";
import type { ActualBillOccurrence } from "../../../shared/types/actual";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import type { TodoistTask } from "../../../shared/types/tasks";

export type GlanceKind = "deadline" | "bill" | "event";
export type GlanceActionKey = "complete" | "edit" | "todoist" | "actual" | "pay" | "zoom" | "eventUrl" | "gcal" | "openInCalendar";
export interface GlanceAction {
  key: GlanceActionKey;
  label: string;
  type: "command" | "link";
  tone: "success" | "ghost" | "accent";
  href?: string;
}

export interface GlanceActionContext {
  actualBudgetUrl?: string | null;
  payLinksByScheduleId?: Record<string, string>;
}
type DashboardGlanceDeadline = Partial<TodoistTask> & { status?: string };
type DashboardGlanceBill = Partial<ActualBillOccurrence>;
type DashboardGlanceEvent = Partial<NormalizedCalendarEvent>;

// Ordered action descriptors for the dashboard glance sheet's action row, by item
// kind. Link actions carry an href; command actions ("complete"/"edit"/
// "openInCalendar") are wired to handlers by the sheet. "openInCalendar" is the
// explicit deep-link CTA present on every item. Pure — no React, no handlers.

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

function billActions(bill: DashboardGlanceBill, ctx: GlanceActionContext): GlanceAction[] {
  const out: GlanceAction[] = [];
  const scheduleUrl = getScheduleUrl(bill, ctx.actualBudgetUrl);
  if (scheduleUrl) {
    out.push({ key: "actual", label: "Open in Actual", type: "link", href: scheduleUrl, tone: "accent" });
  }
  const payUrl = payUrlForBill(bill, ctx.payLinksByScheduleId);
  if (payUrl) {
    out.push({ key: "pay", label: "Pay online", type: "link", href: payUrl, tone: "accent" });
  }
  out.push(openInCalendarAction());
  return out;
}

function eventActions(ev: DashboardGlanceEvent): GlanceAction[] {
  const out: GlanceAction[] = [];
  const zoomUrl = extractZoomMeetingUrl(ev);
  if (zoomUrl) {
    out.push({ key: "zoom", label: "Join Zoom", type: "link", href: zoomUrl, tone: "accent" });
  }
  const eventUrl = extractNonZoomEventUrl(ev);
  if (eventUrl) {
    out.push({ key: "eventUrl", label: "Open URL", type: "link", href: eventUrl, tone: "ghost" });
  }
  const gcalUrl = calendarActionUrl(ev);
  if (gcalUrl) {
    out.push({ key: "gcal", label: "Open in Google Calendar", type: "link", href: gcalUrl, tone: "ghost" });
  }
  out.push(openInCalendarAction());
  return out;
}

export function selectGlanceActions({ kind, item, ctx = {} }: {
  kind: GlanceKind;
  item: DashboardGlanceDeadline | DashboardGlanceBill | DashboardGlanceEvent | null;
  ctx?: GlanceActionContext;
}): GlanceAction[] {
  if (!item) return [];
  if (kind === "deadline") return deadlineActions(item as DashboardGlanceDeadline);
  if (kind === "bill") return billActions(item as DashboardGlanceBill, ctx);
  if (kind === "event") return eventActions(item as DashboardGlanceEvent);
  return [];
}
