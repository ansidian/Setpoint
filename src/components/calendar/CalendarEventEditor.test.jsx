import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarModal from "./CalendarModal.jsx";

const mockGetCalendarSources = vi.fn();
const mockCreateCalendarEvent = vi.fn();
const mockCreateCalendarEventsBatch = vi.fn();
const mockUpdateCalendarEvent = vi.fn();
const mockDeleteCalendarEvent = vi.fn();
const mockGetGmailAuthUrl = vi.fn();
const mockGetCalendarPlaceSuggestions = vi.fn();
const mockGetCalendarPlaceDetails = vi.fn();

vi.mock("@/api", () => ({
  getCalendarSources: (...args) => mockGetCalendarSources(...args),
  createCalendarEvent: (...args) => mockCreateCalendarEvent(...args),
  createCalendarEventsBatch: (...args) => mockCreateCalendarEventsBatch(...args),
  updateCalendarEvent: (...args) => mockUpdateCalendarEvent(...args),
  deleteCalendarEvent: (...args) => mockDeleteCalendarEvent(...args),
  getGmailAuthUrl: (...args) => mockGetGmailAuthUrl(...args),
  getCalendarPlaceSuggestions: (...args) => mockGetCalendarPlaceSuggestions(...args),
  getCalendarPlaceDetails: (...args) => mockGetCalendarPlaceDetails(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.innerWidth = 1600;
  mockGetCalendarSources.mockResolvedValue({
    accounts: [
      {
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [
          {
            id: "primary",
            summary: "Personal",
            accessRole: "owner",
            primary: true,
            writable: true,
          },
        ],
      },
    ],
  });
  mockGetCalendarPlaceSuggestions.mockResolvedValue({ places: [] });
  mockGetCalendarPlaceDetails.mockResolvedValue({
    place: {
      placeId: "place-1",
      displayName: "McDonald's",
      formattedAddress: "123 Main St, Los Angeles, CA 90012, USA",
      location: "McDonald's, 123 Main St, Los Angeles, CA 90012, USA",
    },
  });
  mockCreateCalendarEventsBatch.mockResolvedValue({ created: [], failed: [] });
});

function renderModal({
  events = [],
  focusDate = "2026-04-20",
  refreshRange = vi.fn().mockResolvedValue([]),
  upsertEvents = vi.fn(),
  removeEvent = vi.fn(),
} = {}) {
  const utils = render(
    <CalendarModal
      open
      onClose={() => {}}
      view="events"
      onViewChange={() => {}}
      focusDate={focusDate}
      eventsData={{
        editable: true,
        getEvents: () => events,
        refreshRange,
        upsertEvents,
        removeEvent,
      }}
      billsData={{}}
      deadlinesData={{}}
    />,
  );
  return { ...utils, refreshRange, upsertEvents, removeEvent };
}

describe("Calendar event editor rail", () => {
  it("opens the create editor before calendar sources finish loading", async () => {
    let resolveSources;
    mockGetCalendarSources.mockReturnValue(new Promise((resolve) => {
      resolveSources = resolve;
    }));
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-source").value).toBe("");
    expect(mockGetCalendarSources).toHaveBeenCalledTimes(1);

    resolveSources({
      accounts: [
        {
          accountId: "gmail-main",
          accountLabel: "Google",
          accountEmail: "me@example.com",
          calendars: [
            {
              id: "primary",
              summary: "Personal",
              accessRole: "owner",
              primary: true,
              writable: true,
            },
          ],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-source").value).toBe("gmail-main::primary");
    });
  });

  it("deletes a selected single event from the detail action", async () => {
    const event = {
      id: "event-1",
      etag: '"etag-1"',
      title: "Writable meeting",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
      htmlLink: "https://calendar.google.com",
    };
    const { refreshRange, removeEvent } = renderModal({ events: [event] });

    fireEvent.click((await screen.findAllByTestId("timeline-detail-row"))[0]);
    expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /edit details/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-delete")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("calendar-event-delete"));
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText("Confirm delete")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Confirm delete"));
    await waitFor(() => {
      expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-1", {
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-1"',
      });
    });
    expect(removeEvent).toHaveBeenCalledWith("event-1");
    expect(refreshRange).not.toHaveBeenCalled();
  });

  it("blocks save and shows inline validation for invalid end times", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title").value).toBe("Planning block");
      expect(screen.getByTestId("calendar-event-source").value).toBe("gmail-main::primary");
    });

    fireEvent.click(screen.getByTestId("calendar-event-start-time"));
    fireEvent.click(await screen.findByRole("button", { name: /set start time/i }));
    fireEvent.click(screen.getByTestId("calendar-event-end-time"));
    fireEvent.click(await screen.findByRole("button", { name: /set end time/i }));

    fireEvent.click(screen.getByTestId("calendar-event-start-time"));
    fireEvent.change(screen.getByLabelText("hour"), { target: { value: "9" } });
    fireEvent.blur(screen.getByLabelText("hour"));
    fireEvent.click(await screen.findByRole("button", { name: /set start time/i }));

    fireEvent.click(screen.getByTestId("calendar-event-end-time"));
    fireEvent.change(screen.getByLabelText("hour"), { target: { value: "8" } });
    fireEvent.blur(screen.getByLabelText("hour"));
    fireEvent.click(await screen.findByRole("button", { name: /set end time/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-validation").textContent).toMatch(/end time/i);
    });
    expect(screen.getByTestId("calendar-event-save").disabled).toBe(true);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("renders batch review UI for batch NLP and saves via the batch API", async () => {
    renderModal();
    mockCreateCalendarEventsBatch.mockResolvedValue({
      created: [
        {
          index: 0,
          event: {
            id: "batch-1",
            title: "Work",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-21T11:15:00.000Z").getTime(),
            endMs: new Date("2026-04-21T14:30:00.000Z").getTime(),
            writable: true,
            allDay: false,
          },
        },
        {
          index: 1,
          event: {
            id: "batch-2",
            title: "Work",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-24T11:15:00.000Z").getTime(),
            endMs: new Date("2026-04-24T14:30:00.000Z").getTime(),
            writable: true,
            allDay: false,
          },
        },
      ],
      failed: [],
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work next tue, wed, thur at 4:15am to 7:30am" },
    });

    await waitFor(() => {
      const supportBand = screen.getByTestId("calendar-modal-support-band");
      expect(screen.getByTestId("calendar-event-title-preview").textContent).toMatch(/apr 28, 2026/i);
      expect(screen.getByTestId("calendar-batch-review")).toBeTruthy();
      expect(screen.getByTestId("calendar-event-title-mode-preview").textContent).toMatch(/3 one-off events/i);
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
      expect(supportBand.textContent).toMatch(/3 events/i);
      expect(supportBand.textContent).toMatch(/apr 28/i);
      expect(supportBand.textContent).not.toMatch(/choose a calendar/i);
      expect(supportBand.textContent).not.toMatch(/ready for details/i);
    });

    fireEvent.click(screen.getByTestId("calendar-batch-remove-1"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-batch-row-2")).toBeNull();
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create 2 events/i);
    });

    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockCreateCalendarEventsBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          title: "Work",
          startDate: "2026-04-28",
          endDate: "2026-04-28",
          startTime: "04:15",
          endTime: "07:30",
        }),
        expect.objectContaining({
          title: "Work",
          startDate: "2026-04-30",
          endDate: "2026-04-30",
          startTime: "04:15",
          endTime: "07:30",
        }),
      ]);
    });
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("renders recurrence UI for recurring NLP and saves structured recurrence", async () => {
    renderModal();
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        id: "series-1",
        title: "Work",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T10:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T15:00:00.000Z").getTime(),
        writable: true,
        allDay: false,
        isRecurring: true,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work at 3am to 8am every monday" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title-preview").textContent).toMatch(/apr 20, 2026/i);
      expect(screen.getByTestId("calendar-recurrence-section")).toBeTruthy();
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create recurring event/i);
    });

    fireEvent.change(screen.getByTestId("calendar-recurrence-frequency"), {
      target: { value: "monthly" },
    });
    fireEvent.change(screen.getByTestId("calendar-recurrence-interval"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("calendar-recurrence-ends-type"), {
      target: { value: "onDate" },
    });
    fireEvent.click(await screen.findByTestId("calendar-recurrence-until-date"));
    fireEvent.click(within(await screen.findByLabelText("Recurrence end date picker")).getByRole("button", { name: "24" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Recurrence end date picker")).toBeNull();
      expect(screen.getByTestId("calendar-recurrence-until-date").textContent).toMatch(/apr 24, 2026/i);
    });

    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
        title: "Work",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "03:00",
        endTime: "08:00",
        recurrence: {
          frequency: "monthly",
          interval: 2,
          monthDay: 20,
          ends: {
            type: "onDate",
            untilDate: "2026-04-24",
          },
        },
      }));
    });
  });

  it("keeps the editor open when selecting a recurrence ends option from the floating listbox", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work at 3am to 8am every monday" },
    });

    const recurrenceSection = await screen.findByTestId("calendar-recurrence-section");
    expect(recurrenceSection).toBeTruthy();

    fireEvent.click(within(recurrenceSection).getByRole("button", { name: /^never$/i }));
    expect(screen.getByRole("listbox", { name: /select option/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("option", { name: /on date/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-recurrence-ends-type").value).toBe("onDate");
      expect(screen.getByTestId("calendar-recurrence-until-date")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("calendar-recurrence-until-date"));
    fireEvent.click(within(await screen.findByLabelText("Recurrence end date picker")).getByRole("button", { name: "25" }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.queryByLabelText("Recurrence end date picker")).toBeNull();
      expect(screen.getByTestId("calendar-recurrence-until-date").textContent).toMatch(/apr 25, 2026/i);
    });
  });

  it("applies parsed title changes while editing an existing event", async () => {
    renderModal({
      events: [
        {
          id: "event-edit-nlp",
          etag: '"etag-edit-nlp"',
          title: "Planning block",
          accountId: "gmail-main",
          calendarId: "primary",
          startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
          endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
          writable: true,
          isRecurring: false,
          allDay: false,
          htmlLink: "https://calendar.google.com",
        },
      ],
    });
    mockUpdateCalendarEvent.mockResolvedValue({
      event: {
        id: "event-edit-nlp",
        title: "Dinner",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-21T00:00:00.000Z").getTime(),
        endMs: new Date("2026-04-21T00:30:00.000Z").getTime(),
        writable: true,
        allDay: false,
      },
    });

    fireEvent.click(screen.getByTestId("calendar-cell-item-chip"));
    fireEvent.click(screen.getByRole("button", { name: /edit details/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner on Apr 21 at 5pm" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title-preview").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-event-end-date").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/5:00 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/5:30 pm/i);
    });

    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-edit-nlp", expect.objectContaining({
        title: "Dinner",
        startDate: "2026-04-21",
        endDate: "2026-04-21",
        startTime: "17:00",
        endTime: "17:30",
      }));
    });
  });

  it("does not flash the title validation error on the first typed character", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "D" },
    });

    expect(screen.queryByTestId("calendar-event-validation")).toBeNull();
  });

  it("shows location suggestions and resolves a selected place into the location field", async () => {
    renderModal();
    mockGetCalendarPlaceSuggestions.mockResolvedValue({
      places: [
        {
          placeId: "place-1",
          primaryText: "McDonald's",
          secondaryText: "123 Main St, Los Angeles, CA",
          fullText: "McDonald's 123 Main St, Los Angeles, CA",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.focus(screen.getByTestId("calendar-event-location"));
    fireEvent.input(screen.getByTestId("calendar-event-location"), {
      target: { value: "McDonald's" },
    });

    expect(await screen.findByText("McDonald's")).toBeTruthy();
    fireEvent.click(screen.getByText("McDonald's"));

    await waitFor(() => {
      expect(mockGetCalendarPlaceDetails).toHaveBeenCalledWith("place-1", expect.any(String));
      expect(screen.getByTestId("calendar-event-location").value).toBe("McDonald's, 123 Main St, Los Angeles, CA 90012, USA");
    });
  });

  it("lets the user arrow through location suggestions and press enter to commit one", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    renderModal();
    mockGetCalendarPlaceSuggestions.mockResolvedValue({
      places: [
        {
          placeId: "place-1",
          primaryText: "McDonald's South El Monte",
          secondaryText: "123 Garvey Ave, South El Monte, CA 91733, USA",
          fullText: "McDonald's South El Monte, 123 Garvey Ave, South El Monte, CA 91733, USA",
        },
        {
          placeId: "place-2",
          primaryText: "McDonald's El Monte",
          secondaryText: "456 Valley Blvd, El Monte, CA 91731, USA",
          fullText: "McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA",
        },
      ],
    });
    mockGetCalendarPlaceDetails.mockResolvedValue({
      place: {
        placeId: "place-2",
        displayName: "McDonald's El Monte",
        formattedAddress: "456 Valley Blvd, El Monte, CA 91731, USA",
        location: "McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    const locationInput = screen.getByTestId("calendar-event-location");
    fireEvent.focus(locationInput);
    fireEvent.input(locationInput, {
      target: { value: "McDonald's" },
    });

    expect(await screen.findByText("McDonald's South El Monte")).toBeTruthy();
    scrollIntoView.mockClear();
    fireEvent.keyDown(locationInput, { key: "ArrowDown" });
    fireEvent.keyDown(locationInput, { key: "Enter" });

    try {
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
        expect(mockGetCalendarPlaceDetails).toHaveBeenCalledWith("place-2", expect.any(String));
        expect(screen.getByTestId("calendar-event-location").value).toBe("McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA");
      });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("auto-advances from start date to end date and from start time to end time", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-date"));
    fireEvent.click(within(await screen.findByLabelText("Start date picker")).getByRole("button", { name: "22" }));
    expect(await screen.findByLabelText("End date picker")).toBeTruthy();

    fireEvent.click(within(screen.getByLabelText("End date picker")).getByRole("button", { name: "23" }));
    await waitFor(() => {
      expect(screen.queryByLabelText("End date picker")).toBeNull();
      expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/apr 22, 2026/i);
      expect(screen.getByTestId("calendar-event-end-date").textContent).toMatch(/apr 23, 2026/i);
    });

    fireEvent.click(screen.getByTestId("calendar-event-start-time"));
    expect(await screen.findByLabelText("hour")).toBe(document.activeElement);
    fireEvent.click(await screen.findByRole("button", { name: /set start time/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("End time picker")).toBeTruthy();
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/9:30 am/i);
      expect(screen.getByLabelText("hour")).toBe(document.activeElement);
    });
  });

  it("routes parsed title locations through the place suggestions flow", async () => {
    renderModal();
    mockGetCalendarPlaceSuggestions.mockResolvedValue({
      places: [
        {
          placeId: "place-1",
          primaryText: "McDonald's South El Monte",
          secondaryText: "123 Garvey Ave, South El Monte, CA 91733, USA",
          fullText: "McDonald's South El Monte, 123 Garvey Ave, South El Monte, CA 91733, USA",
        },
        {
          placeId: "place-2",
          primaryText: "McDonald's El Monte",
          secondaryText: "456 Valley Blvd, El Monte, CA 91731, USA",
          fullText: "McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA",
        },
      ],
    });
    mockGetCalendarPlaceDetails.mockResolvedValue({
      place: {
        placeId: "place-2",
        displayName: "McDonald's El Monte",
        formattedAddress: "456 Valley Blvd, El Monte, CA 91731, USA",
        location: "McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    const titleInput = screen.getByTestId("calendar-event-title");
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner 5pm @McDonald's" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-location").value).toBe("McDonald's");
      expect(mockGetCalendarPlaceSuggestions).toHaveBeenCalledWith("McDonald's", expect.any(String));
      expect(screen.getByText("McDonald's South El Monte")).toBeTruthy();
    });

    fireEvent.keyDown(titleInput, { key: "ArrowDown" });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => {
      expect(mockGetCalendarPlaceDetails).toHaveBeenCalledWith("place-2", expect.any(String));
      expect(screen.getByTestId("calendar-event-location").value).toBe("McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA");
      expect(screen.getByTestId("calendar-event-title").value).toBe("Dinner 5pm ");
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/5:00 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/5:30 pm/i);
    });
  });

  it("routes parsed title source tokens through the source picker flow", async () => {
    mockGetCalendarSources.mockResolvedValue({
      accounts: [
        {
          accountId: "gmail-main",
          accountLabel: "Google",
          accountEmail: "me@example.com",
          calendars: [
            {
              id: "primary",
              summary: "Personal",
              accessRole: "owner",
              primary: true,
              writable: true,
            },
            {
              id: "school",
              summary: "School",
              accessRole: "owner",
              writable: true,
            },
            {
              id: "work",
              summary: "Work",
              accessRole: "owner",
              writable: true,
            },
          ],
        },
      ],
    });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    const titleInput = screen.getByTestId("calendar-event-title");
    fireEvent.input(titleInput, {
      target: { value: "Dinner 2pm cal school" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title-source-preview").textContent).toMatch(/school/i);
      expect(screen.getByLabelText("Calendar source picker")).toBeTruthy();
      expect(screen.getByText("School")).toBeTruthy();
    });

    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-source-trigger").textContent).toMatch(/school/i);
      expect(screen.getByTestId("calendar-event-title").value).toBe("Dinner 2pm ");
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/2:00 pm/i);
    });
  });

  it("saves with mod+enter", async () => {
    renderModal();
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        id: "event-hotkey",
        title: "Planning block",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
        writable: true,
        allDay: false,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
        title: "Planning block",
      }));
    });
  });

  it("cancels the editor on browser back", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
    });
  });

  it("allows saving an event when the end time matches the start time", async () => {
    renderModal();
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        id: "event-equal-time",
        title: "Hold",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
        writable: true,
        allDay: false,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Hold" },
    });

    fireEvent.click(screen.getByTestId("calendar-event-end-time"));
    fireEvent.change(screen.getByLabelText("minute"), { target: { value: "00" } });
    fireEvent.blur(screen.getByLabelText("minute"));
    fireEvent.click(await screen.findByRole("button", { name: /set end time/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-validation")).toBeNull();
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
        title: "Hold",
        startTime: "09:00",
        endTime: "09:00",
      }));
    });
  });
});
