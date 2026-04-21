import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import eventsView from "./eventsView.jsx";
import deadlinesView from "./deadlinesView.jsx";
import billsView from "./billsView.jsx";
import { DashboardProvider } from "../../../context/DashboardContext.jsx";

afterEach(() => {
  cleanup();
});

describe("calendar detail timeline", () => {
  it("renders event detail rows with all-day items first, timed items in order, and no source text", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: [
          {
            id: "timed-late",
            title: "Later meeting",
            startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T18:30:00.000Z").getTime(),
            color: "#4285f4",
            source: "Work Calendar",
            location: "Room B",
            allDay: false,
          },
          {
            id: "all-day",
            title: "Offsite",
            startMs: new Date("2026-04-19T07:00:00.000Z").getTime(),
            endMs: new Date("2026-04-20T07:00:00.000Z").getTime(),
            color: "#34a853",
            source: "Work Calendar",
            allDay: true,
            duration: "All day",
          },
          {
            id: "timed-early",
            title: "Morning review",
            startMs: new Date("2026-04-19T16:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T16:30:00.000Z").getTime(),
            color: "#4285f4",
            source: "Work Calendar",
            location: "Room A",
            allDay: false,
          },
        ],
      }),
    );

    const rows = screen.getAllByTestId("timeline-detail-row").map((row) => row.textContent);
    expect(rows[0]).toContain("Offsite");
    expect(rows[1]).toContain("Morning review");
    expect(rows[2]).toContain("Later meeting");
    expect(screen.queryByText("Work Calendar")).toBeNull();
  });

  it("shows a Join Zoom action for vanity subdomain links in the location", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: [
          {
            id: "zoom-location",
            title: "Advisor sync",
            startMs: new Date("2026-04-19T16:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T16:30:00.000Z").getTime(),
            color: "#4285f4",
            location: "https://example.zoom.us/j/11122233344",
            htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/abc123",
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.getByRole("link", { name: /join zoom meeting/i }).getAttribute("href")).toBe(
      "https://example.zoom.us/j/11122233344",
    );
    expect(screen.getByRole("link", { name: /open in google calendar/i })).toBeTruthy();
    expect(screen.getByText("Zoom meeting")).toBeTruthy();
    expect(screen.queryByText("https://example.zoom.us/j/11122233344")).toBeNull();
  });

  it("shows a Join Zoom action when the link only appears in event notes", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: [
          {
            id: "zoom-description",
            title: "Team sync",
            startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T18:30:00.000Z").getTime(),
            color: "#4285f4",
            location: "Conference Room B",
            description: "Notes: join at https://zoom.us/j/12345678901?pwd=abc.",
            htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/def456",
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.getByRole("link", { name: /join zoom meeting/i }).getAttribute("href")).toBe(
      "https://zoom.us/j/12345678901?pwd=abc",
    );
  });

  it("does not show a Join Zoom action for non-Zoom links", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: [
          {
            id: "non-zoom",
            title: "In-person review",
            startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T18:30:00.000Z").getTime(),
            color: "#4285f4",
            location: "Join docs https://example.com/meeting",
            htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/ghi789",
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.queryByRole("link", { name: /join zoom meeting/i })).toBeNull();
  });

  it("renders deadlines chronologically, uses End of day, and selects rows in-place", () => {
    const onSelect = vi.fn();
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          { id: "todo-1", title: "Open early", due_date: "2026-04-19", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
          { id: "todo-2", title: "Complete early", due_date: "2026-04-19", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "complete" },
          { id: "todo-3", title: "No time task", due_date: "2026-04-19", due_time: null, source: "todoist", class_name: "Inbox", status: "open" },
        ],
      },
    };

    render(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        {deadlinesView.renderDetail({
          selectedDay: 19,
          viewYear: 2026,
          viewMonth: 3,
          items: briefing.todoist.upcoming,
          selectedItemId: "todo-1",
          onSelectItem: onSelect,
        })}
      </DashboardProvider>,
    );

    const rows = screen.getAllByTestId("timeline-detail-row");
    expect(rows[0].textContent).toContain("Open early");
    expect(rows[1].textContent).toContain("End of day");
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.queryByText("Complete early")).toBeNull();
    expect(screen.getByTestId("timeline-detail-section-toggle-completed-deadlines").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("timeline-detail-section-toggle-completed-deadlines"));
    expect(screen.getByText("Complete early")).toBeTruthy();

    const completedRows = screen.getAllByTestId("timeline-detail-row");
    expect(completedRows[2].getAttribute("data-complete")).toBe("true");

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith("todo-3");
  });

  it("shows completed deadlines immediately when a day only has completed items", () => {
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          { id: "todo-2", title: "Complete early", due_date: "2026-04-19", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "complete" },
        ],
      },
    };

    render(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        {deadlinesView.renderDetail({
          selectedDay: 19,
          viewYear: 2026,
          viewMonth: 3,
          items: deadlinesView.getDayState(briefing.todoist.upcoming),
          selectedItemId: "todo-2",
          onSelectItem: () => {},
        })}
      </DashboardProvider>,
    );

    expect(screen.getAllByText("Complete early").length).toBeGreaterThan(1);
  });

  it("compresses completed items in deadline month cells into a subtle count", () => {
    render(
      <div>
        {deadlinesView.renderCellContents({
          items: deadlinesView.getDayState([
            { id: "todo-1", title: "Open early", due_date: "2026-04-19", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
            { id: "todo-2", title: "Complete early", due_date: "2026-04-19", due_time: "11:00 AM", source: "todoist", class_name: "Inbox", status: "complete" },
          ]),
        })}
      </div>,
    );

    expect(screen.getByText("Open early")).toBeTruthy();
    expect(screen.queryByText("Complete early")).toBeNull();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("shows a completed deadline preview when a day has no active items", () => {
    render(
      <div>
        {deadlinesView.renderCellContents({
          items: deadlinesView.getDayState([
            { id: "todo-2", title: "Complete early", due_date: "2026-04-19", due_time: "11:00 AM", source: "todoist", class_name: "Inbox", status: "complete" },
          ]),
        })}
      </div>,
    );

    expect(screen.getByText("Complete early")).toBeTruthy();
  });

  it("shows unpaid bills first and hides paid bills behind a collapsed section", () => {
    render(
      billsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        data: {},
        items: billsView.getDayState([
          { id: "bill-1", name: "Rent", payee: "Rent", amount: 2000, next_date: "2026-04-19", paid: false, type: "bill" },
          { id: "bill-2", name: "Internet", payee: "Internet", amount: 80, next_date: "2026-04-19", paid: true, type: "bill" },
        ]),
      }),
    );

    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.queryByText("Internet")).toBeNull();
    expect(screen.getByTestId("timeline-detail-section-toggle-completed-bills").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("timeline-detail-section-toggle-completed-bills"));
    expect(screen.getByText("Internet")).toBeTruthy();
  });

  it("shows a paid bill preview when a day has no unpaid bills", () => {
    render(
      <div>
        {billsView.renderCellContents({
          items: billsView.getDayState([
            { id: "bill-2", name: "Internet", payee: "Internet", amount: 80, next_date: "2026-04-19", paid: true, type: "bill" },
          ]),
        })}
      </div>,
    );

    expect(screen.getByText("Internet")).toBeTruthy();
  });
});
