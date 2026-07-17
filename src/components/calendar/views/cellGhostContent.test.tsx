import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDeadlinesCellContents } from "./deadlines/DeadlinesCellContent.tsx";
import { renderEventsCellContents } from "./events/EventsCellContent.tsx";

const layout = { tier: "lg", cellHeight: 0, gridGap: 0, weekHeaderGap: 0 } as const;

afterEach(() => {
  cleanup();
});

describe("calendar cell ghost content", () => {
  it("renders event ghosts like event chips with a 12-hour leading time", () => {
    render(renderEventsCellContents({
      items: [],
      ghosts: [{
        id: "event-ghost",
        kind: "event",
        title: "Planning block",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "12:30",
        endTime: "13:00",
        startMs: new Date("2026-04-20T19:30:00.000Z").getTime(),
        endMs: new Date("2026-04-20T20:00:00.000Z").getTime(),
        color: "#4285f4",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chip = screen.getByTestId("calendar-ghost-chip");
    expect(chip.textContent).toContain("12:30p");
    expect(chip.textContent).toContain("Planning block");
    expect(chip.textContent).not.toMatch(/draft|conflict|repeat/i);
  });

  it("does not render event cell content for weather-only metadata", () => {
    const { container } = render(renderEventsCellContents({
      items: [],
      ghosts: [],
      layout,
      day: 22,
      dateKey: "2026-04-22",
      cellMeta: {
        weather: { dateKey: "2026-04-22", high: 72, low: 55, icon: "Sun" },
      },
    }));

    expect(container.innerHTML).toBe("");
  });

  it("maps Google birthday events to special-date month chips", () => {
    render(renderEventsCellContents({
      items: [{
        id: "birthday-1",
        title: "Maya's birthday",
        eventType: "birthday",
        birthdayProperties: { type: "birthday" },
        allDay: true,
        writable: false,
        isRecurring: true,
        startMs: new Date("2026-04-22T07:00:00.000Z").getTime(),
        endMs: new Date("2026-04-23T07:00:00.000Z").getTime(),
        sourceColor: "#ff887c",
        color: "#ff887c",
      }],
      layout,
      day: 22,
      dateKey: "2026-04-22",
    }));

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(chip.querySelector("[data-calendar-chip-meta='true']")).toBeNull();
    expect(chip.querySelector("[data-calendar-chip-recurring='true']")).toBeNull();
    expect(chip.textContent).toContain("Maya's birthday");
    expect(chip.textContent).not.toContain("All day");
  });

  it("renders deadline ghosts with deadline source color and due-time ordering", () => {
    render(renderDeadlinesCellContents({
      items: [
        { id: "late", title: "Late task", due_date: "2026-04-20", due_time: "5:00 PM", source: "todoist", status: "open" },
      ],
      ghosts: [{
        id: "deadline-ghost",
        kind: "deadline",
        title: "Morning task",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        dueTime: "9:00 AM",
        dueMinutes: 540,
        source: "todoist",
        color: "#e44332",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chips = screen.getAllByText(/Morning task|Late task/).map((node) => node.textContent);
    expect(chips).toEqual(["Morning task", "Late task"]);
    expect(screen.getByTestId("calendar-ghost-chip").textContent).toContain("9a");
  });

  it("renders Todoist deadline ghosts in Events cells", () => {
    render(renderEventsCellContents({
      items: [],
      ghosts: [{
        id: "deadline-ghost",
        kind: "deadline",
        title: "Draft Todoist task",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        dueTime: "8:30 AM",
        dueMinutes: 510,
        source: "todoist",
        color: "#e44332",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chip = screen.getByTestId("calendar-ghost-chip");
    expect(chip.textContent).toContain("8:30a");
    expect(chip.textContent).toContain("Draft Todoist task");
  });

  it("orders Todoist deadline ghosts chronologically with deadline items in Events cells", () => {
    render(renderEventsCellContents({
      items: [
        {
          id: "recurring-task",
          title: "Recurring morning task",
          due_date: "2026-04-20",
          due_time: "9:00 AM",
          source: "todoist",
          status: "open",
          is_recurring: true,
          calendarItemKind: "deadline",
        },
      ],
      ghosts: [{
        id: "deadline-ghost",
        kind: "deadline",
        title: "Draft Todoist task",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        dueTime: "10:00 AM",
        dueMinutes: 600,
        source: "todoist",
        color: "#e44332",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chips = screen.getAllByText(/Recurring morning task|Draft Todoist task/).map((node) => node.textContent);
    expect(chips).toEqual(["Recurring morning task", "Draft Todoist task"]);
  });

  it("orders Todoist deadline ghosts chronologically with event items in Events cells", () => {
    render(renderEventsCellContents({
      items: [
        {
          id: "later-event",
          title: "Later calendar event",
          startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
          endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
          color: "#4285f4",
          source: "gmail",
        },
      ],
      ghosts: [{
        id: "deadline-ghost",
        kind: "deadline",
        title: "Draft Todoist task",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        dueTime: "9:00 AM",
        dueMinutes: 540,
        source: "todoist",
        color: "#e44332",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chips = screen.getAllByText(/Draft Todoist task|Later calendar event/).map((node) => node.textContent);
    expect(chips).toEqual(["Draft Todoist task", "Later calendar event"]);
  });

  it("orders event ghosts chronologically even when the ghost only has draft time fields", () => {
    render(renderEventsCellContents({
      items: [
        {
          id: "earlier-event",
          title: "Earlier calendar event",
          startMs: new Date("2026-04-20T21:00:00.000Z").getTime(),
          endMs: new Date("2026-04-20T21:30:00.000Z").getTime(),
          color: "#4285f4",
          source: "gmail",
        },
        {
          id: "dinner-task",
          title: "Air fry dinner",
          due_date: "2026-04-20",
          due_time: "6:45 PM",
          source: "todoist",
          status: "open",
          calendarItemKind: "deadline",
        },
      ],
      ghosts: [{
        id: "event-ghost",
        kind: "event",
        title: "Draft event",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "20:00",
        endTime: "20:30",
        color: "#4285f4",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chips = screen.getAllByText(/Earlier calendar event|Air fry dinner|Draft event/).map((node) => node.textContent);
    expect(chips).toEqual(["Earlier calendar event", "Air fry dinner", "Draft event"]);
  });

  it("keeps overnight timed event starts in chronological order with normal event chips", () => {
    render(renderEventsCellContents({
      items: [
        {
          id: "overnight",
          title: "Work overnight",
          startMs: new Date("2026-05-17T03:15:00.000Z").getTime(),
          endMs: new Date("2026-05-17T09:15:00.000Z").getTime(),
          color: "#4285f4",
          source: "gmail",
        },
        {
          id: "early",
          title: "Work early",
          startMs: new Date("2026-05-16T11:00:00.000Z").getTime(),
          endMs: new Date("2026-05-16T15:00:00.000Z").getTime(),
          color: "#4285f4",
          source: "gmail",
        },
      ],
      pinnedIds: new Set(["overnight"]),
      pinnedIdsByDate: {
        "2026-05-17": new Set(["overnight"]),
      },
      layout,
      day: 16,
      dateKey: "2026-05-16",
    }));

    const chips = screen.getAllByTestId("calendar-cell-item-chip").map((node) => node.textContent);
    expect(chips).toEqual(["4aWork early", "8:15pWork overnight"]);
  });
});
