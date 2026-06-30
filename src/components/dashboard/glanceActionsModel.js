import { normalizeStatus } from "../calendar/views/deadlines/deadlinesModel.js";
import { getScheduleUrl, payUrlForBill } from "../calendar/views/bills/billsModel.js";
import { calendarActionUrl } from "../calendar/views/events/eventDetailModel.js";
import { extractNonZoomEventUrl, extractZoomMeetingUrl } from "../../lib/calendar-links";

// Ordered action descriptors for the dashboard glance sheet's action row, by item
// kind. Link actions carry an href; command actions ("complete"/"edit"/
// "openInCalendar") are wired to handlers by the sheet. "openInCalendar" is the
// explicit deep-link CTA present on every item. Pure — no React, no handlers.

function openInCalendarAction() {
  return { key: "openInCalendar", label: "Open in calendar", type: "command", tone: "ghost" };
}

function deadlineActions(task) {
  const out = [];
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

function billActions(bill, ctx) {
  const out = [];
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

function eventActions(ev) {
  const out = [];
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

export function selectGlanceActions({ kind, item, ctx = {} }) {
  if (!item) return [];
  if (kind === "deadline") return deadlineActions(item);
  if (kind === "bill") return billActions(item, ctx);
  if (kind === "event") return eventActions(item);
  return [];
}
