import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";
import { MobileBottomNav } from "../shell/MobileBottomNav.tsx";
import useCalendarWorkspaceState from "../dashboard/useCalendarWorkspaceState.ts";

const { getCalendarSearch: getCalendarSearchApi } = await import("@/api");
type CalendarSearchResult = Awaited<ReturnType<typeof getCalendarSearchApi>>["results"][number];

describe("CalendarModal today agenda behavior", () => {
  it("dims past event days more than future days without dimming today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-20"
          eventsData={{
            getEvents: () => ([
              {
                id: "event-1",
                title: "Past review",
                startMs: new Date("2026-04-10T17:00:00.000Z").getTime(),
                endMs: new Date("2026-04-10T18:00:00.000Z").getTime(),
                allDay: false,
                color: "#4285f4",
              },
            ]),
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      expect(screen.getByTestId("calendar-cell-10").getAttribute("data-past-tone")).toBe("items");
      expect(screen.getByTestId("calendar-cell-15").getAttribute("data-past-tone")).toBe("empty");
      expect(screen.getByTestId("calendar-cell-20").getAttribute("data-past-tone")).toBe("none");
      expect(screen.getByTestId("calendar-cell-24").getAttribute("data-past-tone")).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps today's empty selection when clicking the selected day again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      const { rerender } = render(wrapWithDashboard(
        <CalendarModal
          open={false}
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={{ getEvents: () => [] }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      await act(async () => {
        rerender(wrapWithDashboard(
          <CalendarModal
            open
            onClose={() => {}}
            view="events"
            onViewChange={() => {}}
            eventsData={{ getEvents: () => [] }}
            billsData={{}}
            deadlinesData={{}}
          />,
        ));
        await Promise.resolve();
      });

      expect(screen.getByTestId("calendar-cell-date-header-2026-04-20")).toBeTruthy();

      const todayCell = screen.getByTestId("calendar-cell-20");
      expect(within(todayCell).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();

      const agendaRail = screen.getByTestId("events-agenda-rail");
      expect(within(agendaRail).getByText("No Events")).toBeTruthy();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");

      fireEvent.click(todayCell);

      expect(within(screen.getByTestId("calendar-cell-20")).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects the grid date header without scrolling the agenda rail", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-22"
        eventsData={{
          getEvents: () => ([
            {
              id: "event-1",
              title: "Work",
              startMs: new Date("2026-04-22T11:15:00.000Z").getTime(),
              endMs: new Date("2026-04-22T15:00:00.000Z").getTime(),
              allDay: false,
              color: "#cba6da",
              writable: true,
            },
            {
              id: "event-2",
              title: "Poster deadline",
              startMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-22T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#f9e2af",
            },
            {
              id: "event-3",
              title: "Assignment block",
              startMs: new Date("2026-04-22T18:00:00.000Z").getTime(),
              endMs: new Date("2026-04-22T20:30:00.000Z").getTime(),
              allDay: false,
              color: "#f38ba8",
            },
            {
              id: "event-4",
              title: "Late workshop",
              startMs: new Date("2026-04-22T23:00:00.000Z").getTime(),
              endMs: new Date("2026-04-23T00:00:00.000Z").getTime(),
              allDay: false,
              color: "#89b4fa",
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const agendaRail = await screen.findByTestId("events-agenda-rail");
    const initialRailContent = getLatestRailContent();
    const rows = within(agendaRail).getAllByTestId("calendar-agenda-event-row");

    fireEvent.click(rows[3]!);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBeTruthy();
      expect(within(screen.getByTestId("calendar-modal-rail")).getAllByText("Late workshop").length).toBeGreaterThan(0);
    });

    agendaRail.scrollTop = 180;
    fireEvent.click(screen.getByTestId("calendar-cell-date-header-2026-04-22"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
      expect(screen.getByTestId("calendar-cell-22").getAttribute("aria-selected")).toBe("true");
      expect(getLatestRailContent()).toBe(initialRailContent);
      expect(agendaRail.scrollTop).toBe(180);
    });
  });

  it("lands the agenda rail on today's date header when opened without a focus date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={{ getEvents: () => [] }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const agendaRail = screen.getByTestId("events-agenda-rail");
      const firstHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-04-01']")!;
      const todayHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-04-20']")!;
      const scrollTo = vi.fn();
      agendaRail.scrollTop = 0;
      agendaRail.scrollTo = scrollTo;
      agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 } as DOMRect);
      firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 } as DOMRect);
      todayHeader.getBoundingClientRect = () => ({ top: 620, bottom: 654, left: 0, right: 280, width: 280, height: 34 } as DOMRect);

      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
        top: 620,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls the visible events agenda to today even while adjacent month data is loading", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-10"
          eventsData={{
            getEvents: (year: number, month: number) => (
              year === 2026 && month === 3 ? [
                {
                  id: "event-today",
                  title: "Today planning",
                  startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
                  endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
                  allDay: false,
                  color: "#89b4fa",
                },
              ] : []
            ),
            isMonthLoading: (year: number, month: number) => year === 2026 && month === 4,
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const agendaRail = screen.getByTestId("events-agenda-rail");
      const todayRow = within(agendaRail).getByTestId("calendar-agenda-event-row");
      const todayHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-04-20']")!;
      const todayContent = todayRow.parentElement!;
      const scrollTo = vi.fn();
      agendaRail.scrollTop = 0;
      agendaRail.scrollTo = scrollTo;
      agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 } as DOMRect);
      todayRow.getBoundingClientRect = () => ({ top: 464, bottom: 508, left: 0, right: 280, width: 280, height: 44 } as DOMRect);
      todayContent.getBoundingClientRect = () => ({ top: 464, bottom: 508, left: 0, right: 280, width: 280, height: 44 } as DOMRect);
      todayHeader.getBoundingClientRect = () => ({ top: 420, bottom: 454, left: 0, right: 280, width: 280, height: 34 } as DOMRect);

      fireEvent.keyDown(document, { key: "t" });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
      expect(scrollTo.mock.calls.some(([command]) => command?.top > 0)).toBe(true);
      expect(agendaRail.scrollTop).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

});

const originalMatchMedia = window.matchMedia;

function setMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("max-width") ? matches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderNavigationCalendar({
  focusDate = "2026-09-10",
  eventsData = { getEvents: () => [] },
}: {
  focusDate?: string;
  eventsData?: Record<string, unknown>;
} = {}) {
  return render(wrapWithDashboard(
    <CalendarModal
      open
      onClose={() => {}}
      view="events"
      onViewChange={() => {}}
      focusDate={focusDate}
      eventsData={eventsData}
      billsData={{}}
      deadlinesData={{}}
    />,
  ));
}

function MobileCalendarRetapHarness() {
  const [tab, setTab] = useState<"calendar" | "dashboard">("calendar");
  const [, setCalendarMounted] = useState(true);
  const workspace = useCalendarWorkspaceState({
    isMobile: true,
    tab,
    setShellTab: (next) => setTab(next === "calendar" ? "calendar" : "dashboard"),
    setCalendarMounted,
    liveData: { actualConfigured: false } as never,
    loadCalendarDeadlines: () => {},
    loadCalendarBills: () => {},
  });
  return (
    <>
      <CalendarModal
        open
        onClose={() => {}}
        view={workspace.calendarView}
        onViewChange={workspace.changeCalendarView}
        focusDate="2026-09-10"
        jumpTodayRequestId={workspace.calendarJumpTodayRequestId}
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
      />
      <MobileBottomNav
        tab={tab}
        onTab={(next) => setTab(next === "calendar" ? "calendar" : "dashboard")}
        onRetap={(next) => {
          if (next === "calendar") workspace.jumpCalendarToToday();
        }}
        inboxUnreadSignalCount={0}
      />
    </>
  );
}

const planningEvent = {
  id: "event-9",
  title: "Planning target",
  startMs: Date.parse("2026-07-14T17:00:00.000Z"),
  endMs: Date.parse("2026-07-14T18:00:00.000Z"),
  allDay: false,
  color: "#4285f4",
  writable: true,
};

const planningSearchResult: CalendarSearchResult = {
  id: "event:event-9",
  type: "event",
  itemId: "event-9",
  itemDate: "2026-07-14",
  title: "Planning target",
  subtitle: "10:00 AM",
  meta: "10:00 AM",
  sourceLabel: "Work",
  sourceColor: "#4285f4",
  coverageKey: "events:work",
  activation: {
    view: "events",
    detailView: "events",
    dateKey: "2026-07-14",
    itemId: "event-9",
  },
  payload: planningEvent,
};

function mockCalendarSearch(result: CalendarSearchResult = planningSearchResult) {
  vi.mocked(getCalendarSearchApi).mockResolvedValue({
    results: [result],
    totalMatches: 1,
    query: "planning",
    scope: "events",
    limit: 50,
    coverage: { sources: [] },
    truncated: false,
  });
}

describe("CalendarModal navigation behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-24T19:00:00.000Z"));
    window.localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("moves the rendered mobile workspace to today from the Today affordance", async () => {
    window.innerWidth = 390;
    setMatchMedia(true);

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-09-10"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{ ensureRange: vi.fn().mockResolvedValue(null) }}
        deadlinesData={{}}
      />,
    ));

    expect(await screen.findByText("September 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Jump to today" }));

    await waitFor(() => {
      expect(screen.getByText("June 2026")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Jump to today" })).toBeNull();
  });

  it("does not jump on initial mount, then moves the rendered mobile workspace when its active Calendar tab is re-tapped", async () => {
    window.innerWidth = 390;
    setMatchMedia(true);

    render(wrapWithDashboard(<MobileCalendarRetapHarness />));
    expect(await screen.findByText("September 2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));

    await waitFor(() => {
      expect(screen.getByText("June 2026")).toBeTruthy();
    });
  });

  it("keeps the mobile workspace unchanged when its active Events toggle is tapped", async () => {
    window.innerWidth = 390;
    setMatchMedia(true);

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-09-10"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{ ensureRange: vi.fn().mockResolvedValue(null) }}
        deadlinesData={{}}
      />,
    ));
    expect(await screen.findByText("September 2026")).toBeTruthy();
    const eventsTab = screen.getByRole("tab", { name: "Events" });
    expect(eventsTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(eventsTab);

    expect(screen.getByText("September 2026")).toBeTruthy();
    expect(eventsTab.getAttribute("aria-selected")).toBe("true");
  });

  it("navigates, selects, and opens detail when a rendered search result is activated", async () => {
    window.innerWidth = 1900;
    setMatchMedia(false);
    mockCalendarSearch();

    renderNavigationCalendar({
      focusDate: "2026-05-12",
      eventsData: {
        getEvents: (year: number, month: number) => (
          year === 2026 && month === 6 ? [planningEvent] : []
        ),
      },
    });

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));
    fireEvent.change(screen.getByRole("textbox", { name: "Calendar search" }), {
      target: { value: "planning" },
    });

    const resultRow = await screen.findByTestId("calendar-search-result-row");
    expect(resultRow.textContent).toContain("Planning target");
    fireEvent.click(resultRow);

    const detail = await screen.findByTestId("calendar-floating-detail-panel");
    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title-month").textContent).toBe("July");
      expect(screen.getByTestId("calendar-month-title-year").textContent).toBe("2026");
      expect(screen.getByTestId("calendar-cell-14").getAttribute("aria-selected")).toBe("true");
      expect(within(detail).getByTestId("calendar-selected-event-title").textContent).toContain("Planning target");
    });
    expect(detail.getAttribute("data-anchor-kind")).toBe("search-result-row");
  });

  it("keeps a search result on a visible trailing day in the current rendered month", async () => {
    window.innerWidth = 1900;
    setMatchMedia(false);
    const trailingEvent = {
      ...planningEvent,
      id: "event-trailing",
      title: "Trailing target",
      startMs: Date.parse("2026-05-02T17:00:00.000Z"),
      endMs: Date.parse("2026-05-02T18:00:00.000Z"),
    };
    mockCalendarSearch({
      ...planningSearchResult,
      id: "event:event-trailing",
      itemId: "event-trailing",
      itemDate: "2026-05-02",
      title: "Trailing target",
      activation: {
        view: "events",
        detailView: "events",
        dateKey: "2026-05-02",
        itemId: "event-trailing",
      },
      payload: trailingEvent,
    });

    renderNavigationCalendar({
      focusDate: "2026-04-20",
      eventsData: {
        getEvents: (year: number, month: number) => (
          year === 2026 && month === 4 ? [trailingEvent] : []
        ),
      },
    });

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));
    fireEvent.change(screen.getByRole("textbox", { name: "Calendar search" }), {
      target: { value: "trailing" },
    });
    fireEvent.click(await screen.findByTestId("calendar-search-result-row"));

    const detail = await screen.findByTestId("calendar-floating-detail-panel");
    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title-month").textContent).toBe("April");
      expect(screen.getByTestId("calendar-cell-2026-05-02").getAttribute("aria-selected")).toBe("true");
      expect(within(detail).getByTestId("calendar-selected-event-title").textContent).toContain("Trailing target");
    });
  });
});
