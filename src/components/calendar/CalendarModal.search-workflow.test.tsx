import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

const { getCalendarSearch: getCalendarSearchApi } = await import("@/api");
type CalendarSearchResult = Awaited<ReturnType<typeof getCalendarSearchApi>>["results"][number];

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

function renderSearchCalendar({
  focusDate = "2026-09-10",
  eventsData = { getEvents: () => [] },
  billsRangeData,
}: {
  focusDate?: string;
  eventsData?: Record<string, unknown>;
  billsRangeData?: Record<string, unknown>;
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
      billsRangeData={billsRangeData}
      deadlinesData={{}}
    />,
  ));
}

function ControlledViewSearchCalendar() {
  const [view, setView] = useState("events");
  return (
    <CalendarModal
      open
      onClose={() => {}}
      view={view}
      onViewChange={setView}
      focusDate="2026-09-10"
      eventsData={{ getEvents: () => [] }}
      billsData={{}}
      billsRangeData={{ ensureRange: async () => {} }}
      deadlinesData={{}}
    />
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

const mirrorEvent = {
  ...planningEvent,
  id: "mirror-work-1",
  title: "Mirror work",
};

const mirrorSearchResult: CalendarSearchResult = {
  ...planningSearchResult,
  id: "event:mirror-work-1",
  itemId: "mirror-work-1",
  title: "Mirror work",
  activation: {
    ...planningSearchResult.activation,
    itemId: "mirror-work-1",
  },
  payload: mirrorEvent,
};

const hiddenDeadlineSearchResult: CalendarSearchResult = {
  id: "deadline:todo-1:2026-05-12",
  type: "deadline",
  itemId: "deadline:todo-1:2026-05-12",
  itemDate: "2026-05-12",
  title: "Hidden deadline",
  subtitle: "Due May 12",
  status: "complete",
  meta: "Complete",
  sourceLabel: "Todoist",
  sourceColor: "#e44332",
  coverageKey: "deadlines",
  activation: {
    view: "events",
    detailKind: "deadline",
    dateKey: "2026-05-12",
    itemId: "deadline:todo-1:2026-05-12",
  },
  payload: {
    id: "todo-1",
    dueDate: "2026-05-12",
    status: "complete",
  },
};

describe("CalendarModal search workflow", () => {
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

  it("opens and focuses search from Cmd/Ctrl+F in the rendered workspace", async () => {
    window.innerWidth = 1900;
    setMatchMedia(false);

    renderSearchCalendar();

    fireEvent.keyDown(document, { key: "f", metaKey: true });

    const input = await screen.findByRole("textbox", { name: "Calendar search" }, { timeout: 5000 });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("clears and closes search with Escape without closing the calendar surface", async () => {
    window.innerWidth = 1900;
    setMatchMedia(false);
    mockCalendarSearch();

    renderSearchCalendar();

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));
    const input = await screen.findByRole("textbox", { name: "Calendar search" }, { timeout: 5000 });
    fireEvent.change(input, { target: { value: "planning" } });

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Calendar search" }) as HTMLInputElement).value).toBe("");
    });
    expect(screen.getByTestId("calendar-modal-panel")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Calendar search" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Calendar search" })).toBeNull());
    expect(screen.getByTestId("calendar-modal-panel")).toBeTruthy();
  });

  it("cycles the rendered Calendar view while search is open and focus is outside the rail", async () => {
    window.innerWidth = 1900;
    setMatchMedia(false);
    render(wrapWithDashboard(<ControlledViewSearchCalendar />));

    fireEvent.click(await screen.findByTestId("calendar-search-header-button", {}, { timeout: 5000 }));
    await screen.findByRole("textbox", { name: "Calendar search" });
    fireEvent.keyDown(document, { key: "3" });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Bills" }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("opens a mirrored event result when the current grid has no matching cached item", async () => {
    window.innerWidth = 1900;
    setMatchMedia(false);
    mockCalendarSearch(mirrorSearchResult);

    renderSearchCalendar({
      focusDate: "2026-05-12",
      eventsData: { getEvents: () => [] },
    });

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Calendar search" }, { timeout: 5000 }), {
      target: { value: "mirror" },
    });
    fireEvent.click(await screen.findByTestId("calendar-search-result-row"));

    const detail = await screen.findByTestId("calendar-floating-detail-panel");
    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title-month").textContent).toBe("July");
      expect(screen.getByTestId("calendar-cell-14").getAttribute("aria-selected")).toBe("true");
      expect(within(detail).getByTestId("calendar-selected-event-title").textContent).toContain("Mirror work");
    });
    expect(detail.getAttribute("data-anchor-kind")).toBe("search-result-row");
  });

  it("opens a hidden-overlay deadline result without changing the overlay preference", async () => {
    window.innerWidth = 1900;
    setMatchMedia(false);
    window.localStorage.setItem("calendar:eventsDeadlineOverlay", "false");
    mockCalendarSearch(hiddenDeadlineSearchResult);

    renderSearchCalendar();

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Calendar search" }, { timeout: 5000 }), {
      target: { value: "hidden" },
    });
    fireEvent.click(await screen.findByTestId("calendar-search-result-row"));

    const detail = await screen.findByTestId("calendar-floating-detail-panel");
    await waitFor(() => {
      expect(within(detail).getByTestId("calendar-selected-deadline-title").textContent).toContain("Hidden deadline");
      expect(screen.getByTestId("calendar-cell-12").getAttribute("aria-selected")).toBe("true");
      expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("false");
    });
  });
});
