import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TimelineRow from "./TimelineRow.jsx";
import { deriveTimelineRowState } from "./timeline-helpers.js";

// TimelineRow (PERF-L01) no longer accepts a raw `now` prop — its now-derived
// primitives (isPast/isLive/overdueText/reminderSummary/liveMarker) come from
// deriveTimelineRowState, computed here the same way TimelineDayGroup does.
function timelineRowProps(item, now, { isMobile } = {}) {
  return { ...deriveTimelineRowState(item, now, { isMobile }), item, isMobile };
}

describe("TimelineRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders reminder indicators only for timeline items with upcoming reminders", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const upcomingEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T22:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T23:00:00.000Z").getTime(),
      data: {
        id: "event-reminder",
        title: "Roadmap sync",
        startMs: new Date("2026-05-05T22:00:00.000Z").getTime(),
        endMs: new Date("2026-05-05T23:00:00.000Z").getTime(),
        hasUpcomingReminder: true,
        upcomingReminderCount: 1,
        nextReminderAt: "2026-05-05T21:30:00.000Z",
      },
    };
    const firedDeadline = {
      kind: "deadline",
      dueAtMs: new Date("2026-05-06T06:59:00.000Z").getTime(),
      data: {
        id: "deadline-fired",
        title: "Already pinged",
        due_date: "2026-05-05",
        source: "todoist",
        status: "open",
        hasUpcomingReminder: false,
        upcomingReminderCount: 0,
        nextReminderAt: null,
      },
    };

    render(
      <>
        <TimelineRow accent="#cba6da" {...timelineRowProps(upcomingEvent, now)} />
        <TimelineRow accent="#cba6da" {...timelineRowProps(firedDeadline, now)} />
      </>,
    );

    const indicator = screen.getByTestId("dashboard-reminder-indicator");
    expect(indicator.textContent).toContain("Reminder");
    expect(indicator.textContent).toContain("in 1h 5m");
    expect(screen.getByText("Already pinged").closest("[role='button']")?.textContent).not.toContain("Reminder");
  });

  it("renders deadline timeline rows with domain metadata rather than provider labels", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const deadline = {
      kind: "deadline",
      dueAtMs: new Date("2026-05-06T06:59:00.000Z").getTime(),
      data: {
        id: "deadline-1",
        title: "Submit packet",
        due_date: "2026-05-05",
        class_name: "School",
        source: "canvas",
        status: "open",
        priority: 2,
      },
    };

    render(<TimelineRow accent="#cba6da" {...timelineRowProps(deadline, now)} />);

    const row = screen.getByTestId("timeline-row-desktop");
    expect(row.textContent).toContain("Deadline");
    expect(row.textContent).toContain("School");
    expect(row.textContent).not.toContain("Canvas");
    expect(row.textContent).not.toContain("CTM");
    expect(row.textContent).not.toContain("Todoist");
  });

  it("uses the deadline source color for timeline rows without priority", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const deadline = {
      kind: "deadline",
      dueAtMs: new Date("2026-05-06T06:59:00.000Z").getTime(),
      data: {
        id: "todo-1",
        title: "Mop and Clean",
        due_date: "2026-05-05",
        class_name: "Inbox",
        source: "todoist",
        color: "#e44332",
        status: "open",
      },
    };

    render(<TimelineRow accent="#cba6da" {...timelineRowProps(deadline, now)} />);

    expect(screen.getByTestId("timeline-row-dot").firstElementChild?.style.background).toBe("#e44332");
  });

  it("renders all-day events as all-day rather than timed live blocks", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const allDayEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
      data: {
        id: "cinco",
        title: "Cinco de Mayo",
        allDay: true,
        startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
        endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
      },
    };

    render(<TimelineRow accent="#cba6da" {...timelineRowProps(allDayEvent, now)} />);

    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.queryByText("5:00 am")).toBeNull();
    expect(screen.queryByText("24h")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("renders birthday events as compact special-date markers", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const birthdayEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
      data: {
        id: "birthday-1",
        title: "Maya's birthday",
        eventType: "birthday",
        birthdayProperties: { type: "birthday" },
        allDay: true,
        writable: false,
        startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
        endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
        sourceColor: "#ff887c",
        color: "#ff887c",
      },
    };

    render(<TimelineRow accent="#cba6da" {...timelineRowProps(birthdayEvent, now)} />);

    const row = screen.getByTestId("timeline-row-desktop");
    expect(row.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(row.textContent).toContain("Maya's birthday");
    expect(row.textContent).not.toContain("All day");
    expect(row.querySelector("[data-dashboard-timeline-title='true']")?.style.WebkitLineClamp).toBe("2");
  });

  it("renders a bounded in-card now marker only for the live event row", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const liveEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T20:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T21:00:00.000Z").getTime(),
      data: { id: "live-1", title: "Product sync", startMs: new Date("2026-05-05T20:00:00.000Z").getTime(), endMs: new Date("2026-05-05T21:00:00.000Z").getTime() },
    };
    const pastEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T18:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T19:00:00.000Z").getTime(),
      data: { id: "past-1", title: "Earlier standup", startMs: new Date("2026-05-05T18:00:00.000Z").getTime(), endMs: new Date("2026-05-05T19:00:00.000Z").getTime() },
    };

    render(<TimelineRow accent="#cba6da" {...timelineRowProps(liveEvent, now)} />);
    const marker = screen.getByTestId("timeline-now-marker");
    expect(marker.textContent).toContain("NOW");
    expect(marker.textContent).toContain("% elapsed");
    expect(marker.textContent).toContain("42%");

    cleanup();
    render(<TimelineRow accent="#cba6da" {...timelineRowProps(pastEvent, now)} />);
    expect(screen.queryByTestId("timeline-now-marker")).toBeNull();
  });
});
