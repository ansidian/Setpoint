import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentType, ReactNode } from "react";
import { DashboardProvider as StrictDashboardProvider } from "../../../context/DashboardContext";
import billsView from "./billsView.tsx";
import eventsView from "./eventsView.tsx";
import { renderDeadlinesDetail, renderDeadlinesFloatingDetail } from "./deadlines/DeadlinesDetailRail.tsx";
import { getDayState as getDeadlineDayState } from "./deadlines/deadlinesModel.ts";

const DashboardProvider = StrictDashboardProvider as unknown as ComponentType<{
  children: ReactNode;
  [key: string]: unknown;
}>;
const mockCompleteDeadlineOccurrence = vi.hoisted(() => vi.fn());

vi.mock("../../../api", () => ({
  dismissEmail: vi.fn(),
  completeDeadlineOccurrence: (...args: unknown[]) => mockCompleteDeadlineOccurrence(...args),
  dismissTombstone: vi.fn(),
}));

const deadlinesDetail = {
  getDayState: getDeadlineDayState,
  renderDetail: renderDeadlinesDetail,
  renderFloatingDetail: renderDeadlinesFloatingDetail,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("calendar detail timeline rendering", () => {
  it("renders representative event rows in model order and forwards row selection", () => {
    const onSelectItem = vi.fn();
    render(eventsView.renderDetail({
      selectedDay: 19,
      viewYear: 2026,
      viewMonth: 3,
      onSelectItem,
      items: [
        {
          id: "timed-late",
          title: "Later meeting",
          startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
          endMs: new Date("2026-04-19T18:30:00.000Z").getTime(),
          color: "#4285f4",
          source: "Work Calendar",
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
        },
        {
          id: "timed-early",
          title: "Morning review",
          startMs: new Date("2026-04-19T16:00:00.000Z").getTime(),
          endMs: new Date("2026-04-19T16:30:00.000Z").getTime(),
          color: "#4285f4",
          source: "Work Calendar",
          allDay: false,
        },
      ],
    }));

    const rows = screen.getAllByTestId("timeline-detail-row");
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Offsite"),
      expect.stringContaining("Morning review"),
      expect.stringContaining("Later meeting"),
    ]));
    expect(rows[0]!.textContent).toContain("Offsite");
    expect(rows[1]!.textContent).toContain("Morning review");
    expect(screen.queryByText("Work Calendar")).toBeNull();

    fireEvent.click(rows[1]!);
    expect(onSelectItem).toHaveBeenCalledWith("timed-early");
  });

  it("renders a Google birthday as a read-only special-date detail", () => {
    render(eventsView.renderDetail({
      selectedDay: 22,
      viewYear: 2026,
      viewMonth: 4,
      selectedItemId: "birthday-1_20260522",
      items: [{
        id: "birthday-1_20260522",
        title: "Maya's birthday",
        eventType: "birthday",
        birthdayProperties: { type: "birthday", contact: "people/c12345" },
        startMs: new Date("2026-05-22T19:00:00.000Z").getTime(),
        endMs: new Date("2026-05-23T19:00:00.000Z").getTime(),
        color: "#5484ed",
        openUrl: "https://calendar.google.com/calendar/u/0/r/eventedit/birthday-1",
        writable: false,
        allDay: true,
        isRecurring: true,
      }],
    }));

    const card = screen.getByTestId("calendar-selected-event-card");
    expect(card.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(card.textContent).toContain("Birthday");
    expect(card.textContent).toContain("Read-only");
    expect(screen.queryByRole("button", { name: /edit details/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /open calendar/i })).toBeNull();
  });

  it("renders event action projections and forwards edit", () => {
    const onEditEvent = vi.fn();
    render(eventsView.renderDetail({
      selectedDay: 19,
      viewYear: 2026,
      viewMonth: 3,
      selectedItemId: "event-actions",
      onEditEvent,
      items: [{
        id: "event-actions",
        title: "Planning block",
        startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
        endMs: new Date("2026-04-19T19:00:00.000Z").getTime(),
        color: "#4285f4",
        location: "https://example.zoom.us/j/11122233344",
        description: "Prep https://docs.example.com/agenda.",
        htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/actions",
        writable: true,
        allDay: false,
      }],
    }));

    expect(screen.getByRole("link", { name: /join zoom/i }).getAttribute("href"))
      .toBe("https://example.zoom.us/j/11122233344");
    expect(screen.getByRole("link", { name: "Open URL" }).getAttribute("href"))
      .toBe("https://docs.example.com/agenda");
    expect(screen.getByRole("link", { name: /open calendar/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /edit details/i }));
    expect(onEditEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "event-actions" }));
  });

  it("renders Events-overlay deadline status semantics", () => {
    render(eventsView.renderDetail({
      selectedDay: 19,
      viewYear: 2026,
      viewMonth: 3,
      items: [
        { id: "todo-0", title: "Draft essay", due_date: "2026-04-19", status: "in_progress", calendarItemKind: "deadline" },
        { id: "todo-1", title: "Submit report", due_date: "2026-04-19", status: "complete", calendarItemKind: "deadline" },
      ],
    }));

    expect(screen.getByTestId("deadline-status-indicator-todo-0").textContent).toContain("In progress");
    expect(screen.getByText("Submit report").closest("[data-testid='timeline-detail-row']")?.getAttribute("data-complete")).toBe("true");
  });

  it("renders deadline sections, reminder detail, occurrence selection, and completed disclosure", () => {
    const onSelectItem = vi.fn();
    const tasks = [
      {
        id: "todo-1",
        title: "Open early",
        due_date: "2026-04-19",
        due_time: "9:00 AM",
        class_name: "Inbox",
        status: "open",
        hasUpcomingReminder: true,
        nextReminderAt: "2026-04-19T15:30:00.000Z",
      },
      { id: "todo-2", title: "Complete early", due_date: "2026-04-19", due_time: "9:00 AM", class_name: "Inbox", status: "complete" },
      { id: "todo-3", title: "No time task", due_date: "2026-04-19", due_time: null, class_name: "Inbox", status: "open" },
    ];

    render(
      <DashboardProvider deadlines={{ upcoming: tasks }} setCalendarDeadlines={() => {}}>
        {deadlinesDetail.renderDetail({
          selectedDay: 19,
          viewYear: 2026,
          viewMonth: 3,
          items: tasks,
          selectedItemId: "deadline:todo-1:2026-04-19",
          onSelectItem,
        })}
      </DashboardProvider>,
    );

    const activeRows = screen.getAllByTestId("timeline-detail-row");
    expect(activeRows[0]!.textContent).toContain("Open early");
    expect(activeRows[1]!.textContent).toContain("End of day");
    expect(screen.getByTestId("calendar-detail-reminder-indicator").textContent).toContain("Reminder Apr 19");
    expect(screen.queryByText("Complete early")).toBeNull();

    fireEvent.click(activeRows[1]!);
    expect(onSelectItem).toHaveBeenCalledWith("deadline:todo-3:2026-04-19");

    fireEvent.click(screen.getByTestId("timeline-detail-section-toggle-completed-deadlines"));
    const completedRow = screen.getByText("Complete early").closest("[data-testid='timeline-detail-row']");
    expect(completedRow?.getAttribute("data-complete")).toBe("true");
  });

  it("forwards floating deadline completion and closes after the action starts", async () => {
    vi.useFakeTimers();
    mockCompleteDeadlineOccurrence.mockResolvedValueOnce({});
    const onCloseFloatingDetail = vi.fn();
    const task = {
      id: "todo-1",
      title: "Ship report",
      due_date: "2026-04-22",
      due_time: "5:00 PM",
      source: "todoist",
      class_name: "Inbox",
      status: "open",
    };

    render(
      <DashboardProvider deadlines={{ upcoming: [task] }} setCalendarDeadlines={() => {}}>
        {deadlinesDetail.renderFloatingDetail({
          items: [task],
          selectedItemId: "deadline:todo-1:2026-04-22",
          onCloseFloatingDetail,
        })}
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^complete$/i }));
    expect(mockCompleteDeadlineOccurrence).toHaveBeenCalledWith("todo-1", "2026-04-22");
    expect(onCloseFloatingDetail).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(onCloseFloatingDetail).toHaveBeenCalledTimes(1);
  });

  it("renders unpaid bills first and discloses paid bills on request", () => {
    render(billsView.renderDetail({
      selectedDay: 19,
      viewYear: 2026,
      viewMonth: 3,
      data: {},
      items: billsView.getDayState([
        { id: "bill-1", name: "Rent", payee: "Rent", amount: 2000, next_date: "2026-04-19", paid: false, type: "bill" },
        { id: "bill-2", name: "Internet", payee: "Internet", amount: 80, next_date: "2026-04-19", paid: true, type: "bill" },
      ]),
    }));

    expect(screen.getAllByText("Rent").length).toBeGreaterThan(0);
    expect(screen.queryByText("Internet")).toBeNull();
    fireEvent.click(screen.getByTestId("timeline-detail-section-toggle-completed-bills"));
    expect(screen.getByText("Internet")).toBeTruthy();
  });

  it("renders transaction direction and forwards read-only transaction selection", () => {
    const onSelectItem = vi.fn();
    render(billsView.renderDetail({
      selectedDay: 19,
      selectedDateKey: "2026-04-19",
      viewYear: 2026,
      viewMonth: 3,
      data: {},
      selectedItemId: "income-1",
      onSelectItem,
      items: billsView.getDayState([
        { id: "income-1", name: "Employer", payee: "Employer", amount: 5000, date: "2026-04-19", direction: "income", category: "Income", account: "Checking", notes: "May payroll", type: "transaction" },
        { id: "expense-1", name: "Market", payee: "Market", amount: 42, date: "2026-04-19", direction: "expense", category: "Groceries", account: "Checking", type: "transaction" },
      ]),
    }));

    expect(screen.getAllByText("+$5,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("May payroll")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Open in Actual")).toBeNull();
    expect(screen.queryByText("Pay Online")).toBeNull();
    expect(screen.getByText("Inflows")).toBeTruthy();
    expect(screen.getByText("Outflows")).toBeTruthy();
    fireEvent.click(screen.getByText("Market").closest("[data-testid='timeline-detail-row']")!);
    expect(onSelectItem).toHaveBeenCalledWith("expense-1");
  });

  it("renders the finance-range warning without coupling to its inline styles", () => {
    render(billsView.renderDetail({
      selectedDay: 19,
      selectedDateKey: "2026-04-19",
      viewYear: 2026,
      viewMonth: 3,
      data: { transactionsTruncated: true },
      items: billsView.getDayState([
        { id: "expense-1", name: "Market", payee: "Market", amount: 42, date: "2026-04-19", direction: "expense", type: "transaction" },
      ]),
    }));

    expect(within(screen.getByTestId("calendar-bills-source-warning")).getByText(/limited/i)).toBeTruthy();
  });
});
