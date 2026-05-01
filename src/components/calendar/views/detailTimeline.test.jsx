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
    expect(screen.getByTestId("timeline-detail-masthead").textContent).toContain("Events ledger");
    expect(screen.queryByText("Work Calendar")).toBeNull();
  });

  it("switches shared detail rows into compact density on busy days", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: [
          {
            id: "event-1",
            title: "Breakfast",
            startMs: new Date("2026-04-19T15:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T15:30:00.000Z").getTime(),
            color: "#4285f4",
            allDay: false,
          },
          {
            id: "event-2",
            title: "Standup",
            startMs: new Date("2026-04-19T16:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T16:30:00.000Z").getTime(),
            color: "#34a853",
            allDay: false,
          },
          {
            id: "event-3",
            title: "Lunch",
            startMs: new Date("2026-04-19T19:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T19:30:00.000Z").getTime(),
            color: "#f59e0b",
            allDay: false,
          },
          {
            id: "event-4",
            title: "Review",
            startMs: new Date("2026-04-19T22:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T22:30:00.000Z").getTime(),
            color: "#ef4444",
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.getByTestId("timeline-detail-rail").getAttribute("data-density")).toBe("compact");
    expect(screen.getAllByTestId("timeline-detail-row")[0].getAttribute("data-density")).toBe("compact");
  });

  it("uses the compressed selected event card on every event day", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 16,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "event-1",
        items: [
          {
            id: "event-1",
            title: "Work",
            startMs: new Date("2026-04-16T11:15:00.000Z").getTime(),
            endMs: new Date("2026-04-16T15:00:00.000Z").getTime(),
            color: "#cba6da",
            writable: true,
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.getByTestId("calendar-selected-event-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByText("4:15-8:00 AM")).toBeTruthy();
  });

  it("keeps selected event density consistent when switching between same-day items", () => {
    const items = [
      {
        id: "event-1",
        title: "Work",
        startMs: new Date("2026-04-16T11:15:00.000Z").getTime(),
        endMs: new Date("2026-04-16T15:00:00.000Z").getTime(),
        color: "#cba6da",
        writable: true,
        allDay: false,
      },
      {
        id: "event-2",
        title: "(ZOOM) CS4662-01: ADV MACHINE & DEEP LEARNING",
        startMs: new Date("2026-04-16T17:50:00.000Z").getTime(),
        endMs: new Date("2026-04-16T19:05:00.000Z").getTime(),
        color: "#f9c74f",
        location: "SH184",
        isRecurring: true,
        allDay: false,
      },
    ];
    const renderDetail = (selectedItemId) => eventsView.renderDetail({
      selectedDay: 16,
      viewYear: 2026,
      viewMonth: 3,
      selectedItemId,
      items,
    });

    const { rerender } = render(renderDetail("event-1"));
    expect(screen.getByTestId("calendar-selected-event-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByTestId("calendar-selected-event-card").style.height).toBe("");

    rerender(renderDetail("event-2"));

    expect(screen.getByTestId("calendar-selected-event-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByTestId("calendar-selected-event-card").style.height).toBe("");
    expect(screen.getByTestId("calendar-selected-event-title").textContent).toBe("CS4662-01: ADV MACHINE & DEEP LEARNING");
  });

  it("keeps selected event details in the rail", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 16,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "event-2",
        items: [
          {
            id: "event-1",
            title: "Morning review",
            startMs: new Date("2026-04-16T16:00:00.000Z").getTime(),
            endMs: new Date("2026-04-16T16:30:00.000Z").getTime(),
            color: "#cba6da",
            allDay: false,
          },
          {
            id: "event-2",
            title: "Design review",
            startMs: new Date("2026-04-16T17:00:00.000Z").getTime(),
            endMs: new Date("2026-04-16T18:00:00.000Z").getTime(),
            color: "#89b4fa",
            location: "Room A",
            writable: true,
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
    expect(screen.getByRole("button", { name: /edit details/i })).toBeTruthy();
  });

  it("renders selected event CTAs in the selected card footer", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "event-actions",
        onEditEvent: vi.fn(),
        items: [
          {
            id: "event-actions",
            title: "Planning block",
            startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T19:00:00.000Z").getTime(),
            color: "#4285f4",
            htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/actions",
            writable: true,
            allDay: false,
          },
        ],
      }),
    );

    const card = screen.getByTestId("calendar-selected-event-card");
    const dock = screen.getByTestId("timeline-detail-action-dock");

    expect(card.contains(dock)).toBe(true);
    expect(card.textContent).toContain("Edit details");
    expect(card.textContent).toContain("Open Calendar");
    expect(dock.textContent).toContain("Edit details");
    expect(dock.textContent).toContain("Open Calendar");
  });


  it("shows a Join Zoom action for vanity subdomain links in the location", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "zoom-location",
        items: [
          {
            id: "zoom-location",
            title: "Advisor sync",
            startMs: new Date("2026-04-19T16:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T16:30:00.000Z").getTime(),
            color: "#4285f4",
            location: "https://calstatela.zoom.us/j/81820730704",
            htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/abc123",
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.getByRole("link", { name: /join zoom/i }).getAttribute("href")).toBe(
      "https://calstatela.zoom.us/j/81820730704",
    );
    expect(screen.getByRole("link", { name: /open calendar/i })).toBeTruthy();
    expect(screen.getAllByText("Zoom meeting").length).toBeGreaterThan(0);
    expect(screen.queryByText("https://calstatela.zoom.us/j/81820730704")).toBeNull();
  });

  it("shows a Join Zoom action when the link only appears in event notes", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "zoom-description",
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

    expect(screen.getByRole("link", { name: /join zoom/i }).getAttribute("href")).toBe(
      "https://zoom.us/j/12345678901?pwd=abc",
    );
  });

  it("compresses the selected event card for long Zoom events and strips the provider prefix from the displayed title", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 30,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "zoom-long-title",
        items: [
          {
            id: "zoom-long-title",
            title: "(ZOOM) CS4662-01: ADV MACHINE & DEEP LEARNING",
            startMs: new Date("2026-04-30T17:50:00.000Z").getTime(),
            endMs: new Date("2026-04-30T19:05:00.000Z").getTime(),
            color: "#4285f4",
            location: "https://calstatela.zoom.us/j/81820730704",
            htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/zoom-long",
            isRecurring: true,
            allDay: false,
          },
          {
            id: "other-event",
            title: "Work",
            startMs: new Date("2026-04-30T11:15:00.000Z").getTime(),
            endMs: new Date("2026-04-30T15:00:00.000Z").getTime(),
            color: "#f59e0b",
            location: "SH184",
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.getByTestId("calendar-selected-event-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByTestId("calendar-selected-event-title").textContent).toBe("CS4662-01: ADV MACHINE & DEEP LEARNING");
    expect(screen.getByRole("link", { name: /join zoom/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /open calendar/i })).toBeTruthy();
  });

  it("does not show a Join Zoom action for non-Zoom links", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "non-zoom",
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

  it("omits the fallback access fact card when the selected event has no location or attendees", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "no-accessory",
        items: [
          {
            id: "no-accessory",
            title: "Quiet block",
            startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T19:15:00.000Z").getTime(),
            color: "#4285f4",
            htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/jkl012",
            writable: true,
            allDay: false,
          },
        ],
      }),
    );

    expect(screen.queryByText("Editable event")).toBeNull();
    expect(screen.queryByText("Access")).toBeNull();
  });

  it("keeps the selected event compact time on one row", () => {
    render(
      eventsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        selectedItemId: "time-nowrap",
        items: [
          {
            id: "time-nowrap",
            title: "Long meeting",
            startMs: new Date("2026-04-19T17:50:00.000Z").getTime(),
            endMs: new Date("2026-04-19T19:05:00.000Z").getTime(),
            color: "#4285f4",
            location: "SH184",
            allDay: false,
          },
        ],
      }),
    );

    const timeValue = screen.getByText("10:50 AM-12:05 PM");
    expect(timeValue.style.whiteSpace).toBe("nowrap");
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
    expect(screen.getByTestId("timeline-detail-masthead").textContent).toContain("Deadline ledger");
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.getByTestId("calendar-selected-deadline-status").textContent).toContain("Incomplete");
    expect(screen.getByTestId("deadline-status-indicator-todo-1").getAttribute("aria-label")).toBe("Incomplete");
    expect(screen.getByTestId("deadline-status-indicator-todo-3").getAttribute("aria-label")).toBe("Incomplete");
    expect(screen.queryByText("Complete early")).toBeNull();
    expect(screen.getByTestId("timeline-detail-section-toggle-completed-deadlines").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("timeline-detail-section-toggle-completed-deadlines"));
    expect(screen.getByText("Complete early")).toBeTruthy();
    expect(screen.getByTestId("deadline-status-indicator-todo-2").getAttribute("aria-label")).toBe("Complete");

    const completedRows = screen.getAllByTestId("timeline-detail-row");
    expect(completedRows[2].getAttribute("data-complete")).toBe("true");

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith("todo-3");
  });

  it("keeps selected deadline details in the rail", () => {
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          {
            id: "todo-1",
            title: "Ship report",
            due_date: "2026-04-22",
            due_time: "5:00 PM",
            source: "todoist",
            class_name: "Inbox",
            status: "open",
            url: "https://todoist.com/showTask?id=1",
          },
          {
            id: "todo-2",
            title: "Review deck",
            due_date: "2026-04-22",
            due_time: "6:00 PM",
            source: "todoist",
            class_name: "Inbox",
            status: "open",
          },
        ],
      },
    };

    render(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        {deadlinesView.renderDetail({
          selectedDay: 22,
          viewYear: 2026,
          viewMonth: 3,
          items: briefing.todoist.upcoming,
          selectedItemId: "todo-1",
          onSelectItem: () => {},
        })}
      </DashboardProvider>,
    );

    expect(screen.getByTestId("calendar-selected-deadline-title").textContent).toContain("Ship report");
    expect(screen.getByRole("button", { name: /^complete$/i })).toBeTruthy();
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

  it("compresses the selected deadline card on two-deadline days", () => {
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          {
            id: "todo-1",
            title: "mow the lawn",
            due_date: "2026-04-22",
            due_time: "5:00 PM",
            source: "todoist",
            class_name: "Inbox",
            status: "open",
            url: "https://todoist.com/showTask?id=1",
          },
          {
            id: "todo-2",
            title: "Senior Design Deliverables",
            due_date: "2026-04-22",
            due_time: null,
            source: "todoist",
            class_name: "Senior Design (CS 4962-01/02)",
            status: "in_progress",
            url: "https://todoist.com/showTask?id=2",
          },
        ],
      },
    };

    render(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        {deadlinesView.renderDetail({
          selectedDay: 22,
          viewYear: 2026,
          viewMonth: 3,
          items: briefing.todoist.upcoming,
          selectedItemId: "todo-1",
          onSelectItem: () => {},
        })}
      </DashboardProvider>,
    );

    expect(screen.getByTestId("calendar-selected-deadline-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByTestId("calendar-selected-deadline-status").textContent).toContain("Incomplete");
    expect(screen.getByRole("button", { name: /^complete$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /open todoist/i })).toBeTruthy();
  });

  it("keeps deadline secondary CTAs in the same selected-card footer group", () => {
    const task = {
      id: "ctm-1",
      title: "Presentation Slides",
      due_date: "2026-04-29",
      due_time: "11:59 PM",
      source: "manual",
      class_name: "Senior Design (CS 4962-01/02)",
      status: "open",
      url: "https://calstatela.instructure.com/courses/1/assignments/2",
    };

    render(
      <DashboardProvider briefing={{ emails: { accounts: [] }, ctm: { upcoming: [] }, todoist: { upcoming: [] } }} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        {deadlinesView.renderDetail({
          selectedDay: 29,
          viewYear: 2026,
          viewMonth: 3,
          items: [task],
          selectedItemId: "ctm-1",
          onSelectItem: () => {},
        })}
      </DashboardProvider>,
    );

    const card = screen.getByTestId("calendar-selected-deadline-card");
    const dock = screen.getByTestId("timeline-detail-action-dock");
    const complete = screen.getByRole("button", { name: /^complete$/i });
    const inProgress = screen.getByRole("button", { name: /^in progress$/i });
    const openCanvas = screen.getByRole("button", { name: /^open canvas$/i });
    const openCtm = screen.getByRole("button", { name: /^open ctm$/i });

    expect(card.contains(dock)).toBe(true);
    expect(complete.parentElement).toBe(inProgress.parentElement);
    expect(complete.parentElement).toBe(openCanvas.parentElement);
    expect(complete.parentElement).toBe(openCtm.parentElement);
  });

  it("keeps selected deadline density consistent when switching between same-day tasks", () => {
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          {
            id: "todo-1",
            title: "mow the lawn",
            due_date: "2026-04-22",
            due_time: "5:00 PM",
            source: "todoist",
            class_name: "Inbox",
            status: "open",
            url: "https://todoist.com/showTask?id=1",
          },
          {
            id: "todo-2",
            title: "Senior Design Deliverables for Capstone Presentation",
            due_date: "2026-04-22",
            due_time: "11:59 PM",
            source: "todoist",
            class_name: "Senior Design (CS 4962-01/02)",
            status: "in_progress",
            url: "https://todoist.com/showTask?id=2",
          },
        ],
      },
    };
    const renderDetail = (selectedItemId) => (
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        {deadlinesView.renderDetail({
          selectedDay: 22,
          viewYear: 2026,
          viewMonth: 3,
          items: briefing.todoist.upcoming,
          selectedItemId,
          onSelectItem: () => {},
        })}
      </DashboardProvider>
    );

    const { rerender } = render(renderDetail("todo-1"));
    expect(screen.getByTestId("calendar-selected-deadline-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByTestId("calendar-selected-deadline-card").style.height).toBe("");

    rerender(renderDetail("todo-2"));

    expect(screen.getByTestId("calendar-selected-deadline-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByTestId("calendar-selected-deadline-card").style.height).toBe("");
    expect(screen.getByTestId("calendar-selected-deadline-title").textContent).toContain("Senior Design Deliverables");
  });

  it("compresses the selected deadline card for long single deadlines", () => {
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          {
            id: "todo-long",
            title: "Senior Design Deliverables for Capstone Presentation",
            due_date: "2026-04-23",
            due_time: "11:59 PM",
            source: "todoist",
            class_name: "Senior Design (CS 4962-01/02)",
            status: "open",
            url: "https://todoist.com/showTask?id=3",
          },
        ],
      },
    };

    render(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        {deadlinesView.renderDetail({
          selectedDay: 23,
          viewYear: 2026,
          viewMonth: 3,
          items: briefing.todoist.upcoming,
          selectedItemId: "todo-long",
          onSelectItem: () => {},
        })}
      </DashboardProvider>,
    );

    expect(screen.getByTestId("calendar-selected-deadline-card").getAttribute("data-density")).toBe("compressed");
    expect(screen.getByTestId("calendar-selected-deadline-title").textContent).toContain("Senior Design Deliverables");
    expect(screen.getByTestId("calendar-selected-deadline-status").textContent).toContain("Incomplete");
  });

  it("does not render completed deadlines into month cells when active items exist", () => {
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
    expect(screen.getByText("Complete early")).toBeTruthy();
    expect(screen.getByText("Complete early").style.textDecoration).toContain("line-through");
  });

  it("keeps completed-only deadline month cells visually quiet", () => {
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
    expect(screen.getByText("Complete early").style.textDecoration).toContain("line-through");
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

    expect(screen.getAllByText("Rent").length).toBeGreaterThan(0);
    expect(screen.queryByText("Internet")).toBeNull();
    expect(screen.getByTestId("timeline-detail-section-toggle-completed-bills").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("timeline-detail-section-toggle-completed-bills"));
    expect(screen.getByText("Internet")).toBeTruthy();
  });

  it("does not describe selected paid bills as overdue", () => {
    render(
      billsView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        data: {},
        selectedItemId: "bill-2",
        items: billsView.getDayState([
          { id: "bill-2", name: "Internet", payee: "Internet", amount: 80, next_date: "2026-04-19", paid: true, type: "bill" },
        ]),
      }),
    );

    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.getAllByText("Cleared").length).toBeGreaterThan(0);
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
