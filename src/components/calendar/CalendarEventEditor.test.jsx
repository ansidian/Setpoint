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
const mockDeleteTodoistTask = vi.fn();

vi.mock("@/api", () => ({
  getCalendarSources: (...args) => mockGetCalendarSources(...args),
  createCalendarEvent: (...args) => mockCreateCalendarEvent(...args),
  createCalendarEventsBatch: (...args) => mockCreateCalendarEventsBatch(...args),
  updateCalendarEvent: (...args) => mockUpdateCalendarEvent(...args),
  deleteCalendarEvent: (...args) => mockDeleteCalendarEvent(...args),
  getGmailAuthUrl: (...args) => mockGetGmailAuthUrl(...args),
  getCalendarPlaceSuggestions: (...args) => mockGetCalendarPlaceSuggestions(...args),
  getCalendarPlaceDetails: (...args) => mockGetCalendarPlaceDetails(...args),
  deleteTodoistTask: (...args) => mockDeleteTodoistTask(...args),
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

async function openFloatingEventEditorFromSelectedChip() {
  fireEvent.click(screen.getAllByTestId("calendar-cell-item-chip")[0]);
  const panel = await screen.findByTestId("calendar-floating-detail-panel");
  fireEvent.click(within(panel).getByRole("button", { name: /edit details/i }));
  return screen.findByTestId("calendar-event-editor-rail");
}

function getActiveEventSourceTrigger() {
  return screen.getAllByTestId("calendar-event-source-trigger")
    .find((element) => !element.disabled);
}

function getActiveEventSaveButton() {
  return screen.getAllByTestId("calendar-event-save")
    .find((element) => !element.disabled);
}

function getActiveRepeatTrigger(labelPattern = null) {
  return screen.getAllByTestId("calendar-event-repeat-trigger")
    .filter((element) => !element.disabled)
    .filter((element) => !labelPattern || labelPattern.test(element.getAttribute("aria-label") || ""))
    .at(-1);
}

function setCompactSchedulePickerTime(picker, fieldLabel, { hour, minute, period }) {
  const fieldButton = within(picker).getByRole("button", { name: new RegExp(`^${fieldLabel}:`, "i") });
  if (fieldButton.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(fieldButton);
  }
  fireEvent.change(within(picker).getByLabelText("hour"), { target: { value: String(hour) } });
  fireEvent.blur(within(picker).getByLabelText("hour"));
  fireEvent.change(within(picker).getByLabelText("minute"), { target: { value: String(minute).padStart(2, "0") } });
  fireEvent.blur(within(picker).getByLabelText("minute"));
  fireEvent.click(within(picker).getByRole("button", { name: period.toUpperCase() }));
  fireEvent.click(within(picker).getByRole("button", { name: new RegExp(`set ${fieldLabel}`, "i") }));
}

function createDataTransfer() {
  const store = new Map();
  return {
    effectAllowed: "all",
    dropEffect: "move",
    setData: vi.fn((type, value) => store.set(type, value)),
    getData: vi.fn((type) => store.get(type) || ""),
  };
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

  it("auto focuses the title when opening the create editor", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));

    const title = await screen.findByTestId("calendar-event-title");
    await waitFor(() => {
      expect(document.activeElement).toBe(title);
    });
  });

  it("opens event create as a compact Todoist-style icon composer", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));

    const rail = await screen.findByTestId("calendar-event-editor-rail");
    expect(rail.getAttribute("data-editor-layout")).toBe("slim-icon");
    const toolbar = screen.getByTestId("calendar-event-compact-toolbar");
    expect(toolbar).toBeTruthy();
    expect(screen.getByTestId("calendar-event-description")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-description").getAttribute("data-compact-notes")).toBe("true");
    expect(screen.queryByTestId("calendar-event-notes-chip")).toBeNull();
    expect(screen.queryByTestId("calendar-event-editor-detail-layout")).toBeNull();

    [
      "calendar-event-schedule-trigger",
      "calendar-event-source-trigger",
      "calendar-event-location-trigger",
      "calendar-event-repeat-trigger",
    ].forEach((testId) => {
      const button = screen.getByTestId(testId);
      expect(button.textContent.trim()).toBe("");
      expect(button.getAttribute("title")).toBeNull();
      expect(button.getAttribute("aria-label")).toBeTruthy();
    });
    expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 20, 2026/i);
    expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/personal/i);
    expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/does not repeat/i);
    expect(screen.getByTestId("calendar-event-save")).toBeTruthy();
  });

  it("uses the custom time picker inside the compact schedule popover", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-time"));
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    expect(within(picker).queryByLabelText("Start time", { selector: "input" })).toBeNull();
    expect(within(picker).queryByLabelText("End time", { selector: "input" })).toBeNull();

    setCompactSchedulePickerTime(picker, "start time", { hour: 11, minute: 45, period: "pm" });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/11:45 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/12:15 am/i);
      expect(within(picker).getByTestId("calendar-compact-schedule-summary").textContent).toMatch(/11:45 pm to 12:15 am/i);
      expect(within(picker).queryByLabelText("hour")).toBeNull();
    });
  });

  it("opens compact popovers from the icon action row one at a time", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-source-trigger")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("calendar-event-source-trigger"));
    expect(await screen.findByRole("dialog", { name: /calendar source picker/i })).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-schedule-trigger"));
    const schedulePicker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    expect(schedulePicker).toBeTruthy();
    expect(within(schedulePicker).getByTestId("calendar-compact-schedule-summary").textContent).toMatch(/apr 20, 2026/i);
    expect(within(schedulePicker).getByLabelText("All day").checked).toBe(false);
    expect(screen.queryByRole("dialog", { name: /calendar source picker/i })).toBeNull();

    fireEvent.click(screen.getByTestId("calendar-event-title"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /compact schedule picker/i })).toBeNull();
    });
  });

  it("uses repeat as a recurrence popover with real recurrence state", async () => {
    const { refreshRange, upsertEvents } = renderModal();
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        id: "manual-series-1",
        title: "Planning block",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
        writable: true,
        allDay: false,
        isRecurring: true,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });

    fireEvent.click(getActiveRepeatTrigger());
    const repeatPicker = await screen.findByRole("dialog", { name: /recurrence picker/i });
    fireEvent.click(within(repeatPicker).getByRole("option", { name: /weekly/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/every mon/i);
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create recurring event/i);
    });

    fireEvent.click(getActiveEventSaveButton());
    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(refreshRange).toHaveBeenCalledWith("2026-04-20", "2026-04-20");
      expect(upsertEvents).not.toHaveBeenCalled();
    });
  });

  it("auto focuses the title when opening the edit editor", async () => {
    const event = {
      id: "event-focus-edit",
      etag: '"etag-focus-edit"',
      title: "Planning block",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    renderModal({ events: [event] });

    await openFloatingEventEditorFromSelectedChip();

    const title = screen.getByTestId("calendar-event-title");
    await waitFor(() => {
      expect(document.activeElement).toBe(title);
    });
    expect(title.selectionStart).toBe("Planning block".length);
    expect(title.selectionEnd).toBe("Planning block".length);
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

    fireEvent.click((await screen.findAllByTestId("calendar-agenda-event-row"))[0]);
    expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();

    fireEvent.click(within(await screen.findByTestId("calendar-floating-detail-panel")).getByRole("button", { name: /edit details/i }));
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

  it("reschedules a writable event by drag-drop with an optimistic cache update", async () => {
    const event = {
      id: "event-drag-1",
      etag: '"etag-drag-1"',
      title: "Move me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockUpdateCalendarEvent.mockResolvedValue({
      event: {
        ...event,
        startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-21T17:30:00.000Z").getTime(),
      },
    });
    const { upsertEvents } = renderModal({ events: [event] });
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(screen.getByTestId("calendar-cell-item-chip"), { dataTransfer });
    fireEvent.drop(screen.getByTestId("calendar-cell-21"), { dataTransfer });

    await waitFor(() => {
      expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-drag-1", expect.any(Object));
    });
    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
      id: "event-drag-1",
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
    }));
  });

  it("uses the quick-action context menu to delete a writable event", async () => {
    const event = {
      id: "event-context-delete",
      etag: '"etag-context-delete"',
      title: "Delete me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockDeleteCalendarEvent.mockResolvedValue(undefined);
    const { removeEvent } = renderModal({ events: [event] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId("calendar-event-context-delete"));
    fireEvent.click(screen.getByTestId("calendar-event-context-confirm-delete"));

    await waitFor(() => {
      expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete", {
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-context-delete"',
      });
    });
    expect(removeEvent).toHaveBeenCalledWith("event-context-delete");
  });

  it("prevents invalid same-day end times by rolling compact schedule edits overnight", async () => {
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
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    setCompactSchedulePickerTime(picker, "start time", { hour: 9, minute: 0, period: "am" });
    setCompactSchedulePickerTime(picker, "end time", { hour: 8, minute: 0, period: "am" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-validation")).toBeNull();
      expect(screen.getByTestId("calendar-event-end-date").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/8:00 am/i);
    });
    expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("renders a non-interactive ghost preview for a valid create draft", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("calendar-ghost-chip").textContent).toMatch(/untitled/i);
      expect(screen.getByTestId("calendar-ghost-chip").textContent).not.toMatch(/draft|conflict|repeat/i);
      expect(screen.queryByTestId("calendar-ghost-overlay")).toBeNull();
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 20, 2026/i);
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).not.toMatch(/draft preview/i);
    });
  });

  it("uses the compact summary as the only persistent parsed schedule verification", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner on Apr 21 at 5pm" },
    });

    await waitFor(() => {
      const summary = screen.getByTestId("calendar-draft-preview-summary");
      expect(summary.textContent).toMatch(/apr 21, 2026/i);
      expect(summary.textContent).toMatch(/5:00 pm to 5:30 pm/i);
      expect(screen.queryByTestId("calendar-event-title-preview")).toBeNull();
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
    });
  });

  it("keeps source and location assist visible without repeating parsed schedule copy", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner @McDonald's tomorrow 5pm cal personal" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title-location-preview").textContent).toMatch(/mcdonald's/i);
      expect(screen.getByTestId("calendar-event-title-source-preview").textContent).toMatch(/personal/i);
      expect(screen.queryByTestId("calendar-event-title-preview")).toBeNull();
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
    });
  });

  it("adds restrained semantic signaling to compact summary segments", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work at 3am to 8am every monday" },
    });

    await waitFor(() => {
      const segments = screen.getAllByTestId("calendar-draft-preview-segment");
      expect(segments.map((segment) => segment.getAttribute("data-summary-kind"))).toEqual(
        expect.arrayContaining(["schedule", "source", "location", "repeat"]),
      );
      expect(segments.find((segment) => segment.getAttribute("data-summary-kind") === "schedule")?.style.color).toBeTruthy();
      expect(segments.find((segment) => segment.getAttribute("data-summary-kind") === "repeat")?.textContent).toMatch(/every mon/i);
    });
  });

  it("suppresses edit ghosts until placement changes, then flags conflicts excluding the original event", async () => {
    const original = {
      id: "event-edit-ghost",
      etag: '"etag-edit-ghost"',
      title: "Planning block",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const conflict = {
      id: "event-conflict",
      title: "Existing hold",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T16:15:00.000Z").getTime(),
      endMs: new Date("2026-04-21T17:15:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    renderModal({ events: [original, conflict] });

    await openFloatingEventEditorFromSelectedChip();
    expect(screen.queryByTestId("calendar-ghost-overlay")).toBeNull();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block Apr 21 at 9am" },
    });

    await waitFor(() => {
      const chip = screen.getByTestId("calendar-ghost-chip");
      expect(chip.textContent).not.toMatch(/conflict|draft|repeat/i);
      expect(chip.style.border).toContain("dotted");
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/overlaps 1 event/i);
    });
  });

  it("renders a multi-day ghost as a spanning draft chip from the compact schedule picker", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-date"));
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    fireEvent.click(within(picker).getByRole("button", { name: /end date/i }));
    await waitFor(() => {
      expect(within(picker).getByRole("button", { name: "19" }).disabled).toBe(true);
    });
    fireEvent.click(within(picker).getByRole("button", { name: "22" }));
    fireEvent.click(within(picker).getByRole("button", { name: /done/i }));

    await waitFor(() => {
      const chip = screen.getByTestId("calendar-ghost-chip");
      expect(chip.getAttribute("data-ghost-start")).toBe("2026-04-20");
      expect(chip.getAttribute("data-ghost-end")).toBe("2026-04-22");
      expect(chip.style.gridColumn).toBe("2 / 5");
    });
  });

  it("debounces ghost-driven month navigation for NLP date changes", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block May 12 at 9am" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May 2026/i);
      expect(screen.getByTestId("calendar-ghost-chip").getAttribute("data-ghost-start")).toBe("2026-05-12");
    });
  });

  it("renders batch review UI for batch NLP and saves via the batch API", async () => {
    const { upsertEvents } = renderModal();
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
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/3 draft events/i);
      expect(screen.getByTestId("calendar-batch-review")).toBeTruthy();
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId("calendar-batch-remove-1"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-batch-row-2")).toBeNull();
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create 2 events/i);
    });

    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockCreateCalendarEventsBatch).toHaveBeenCalledTimes(1);
      expect(upsertEvents).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "batch-1",
        }),
        expect.objectContaining({
          id: "batch-2",
        }),
      ]);
    });
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("edits retained batch row schedules from the compact schedule picker", async () => {
    const { upsertEvents } = renderModal();
    mockCreateCalendarEventsBatch.mockResolvedValue({
      created: [
        {
          index: 0,
          event: {
            id: "batch-1",
            title: "Work",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-29T00:00:00.000Z").getTime(),
            endMs: new Date("2026-04-29T00:30:00.000Z").getTime(),
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
      expect(screen.getByTestId("calendar-batch-review").getAttribute("data-density")).toBe("compact");
      expect(screen.getByTestId("calendar-batch-row-0").getAttribute("data-density")).toBe("compact");
      expect(screen.getByTestId("calendar-batch-schedule-trigger-0")).toBeTruthy();
      expect(screen.queryByTestId("calendar-batch-start-date-0")).toBeNull();
      expect(screen.queryByTestId("calendar-batch-start-time-0")).toBeNull();
    });

    fireEvent.click(screen.getByTestId("calendar-batch-schedule-trigger-0"));
    const picker = await screen.findByRole("dialog", { name: /batch event 1 schedule/i });

    expect(within(picker).getByTestId("calendar-compact-schedule-summary").textContent).toMatch(/Apr 28, 2026/i);
    expect(within(picker).queryByLabelText("Start time")).toBeNull();

    fireEvent.click(within(picker).getByRole("button", { name: /end date/i }));
    fireEvent.click(within(picker).getAllByRole("button", { name: "29" }).find((button) => !button.disabled));
    setCompactSchedulePickerTime(picker, "start time", { hour: 5, minute: 0, period: "pm" });
    fireEvent.click(within(picker).getByRole("button", { name: /done/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-batch-row-0").textContent).toMatch(/Apr 28, 2026 to Apr 29, 2026/i);
      expect(screen.getByTestId("calendar-batch-row-0").textContent).toMatch(/5:00 PM to 5:30 PM/i);
    });

    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockCreateCalendarEventsBatch).toHaveBeenCalledTimes(1);
      expect(upsertEvents).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "batch-1",
        }),
      ]);
    });
  });

  it("lets the batch icon collapse accidental batch parsing into a single draft", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner 2pm tue thu" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/2 draft events/i);
      expect(screen.getByTestId("calendar-batch-review")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("calendar-event-batch-trigger"));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title").value).toBe("Dinner");
      expect(screen.queryByTestId("calendar-batch-review")).toBeNull();
      expect(screen.queryByTestId("calendar-event-batch-trigger")).toBeNull();
      expect(screen.getByTestId("calendar-event-schedule-trigger")).toBeTruthy();
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/2:00 pm to 2:30 pm/i);
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create event/i);
    });
  });

  it("keeps the create composer mounted while recurring NLP parsing resolves", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    const composerBody = await screen.findByTestId("calendar-event-editor-mode-create");

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work at 3am to 8am every monday" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/every mon/i);
      expect(screen.getByTestId("calendar-event-editor-mode-create")).toBe(composerBody);
    });
  });

  it("keeps the create composer mounted while batch NLP parsing resolves", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    const composerBody = await screen.findByTestId("calendar-event-editor-mode-create");

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work next tue, wed, thur at 4:15am to 7:30am" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/3 draft events/i);
      expect(screen.getByTestId("calendar-event-editor-mode-create")).toBe(composerBody);
    });
  });

  it("renders recurrence UI for recurring NLP and saves structured recurrence", async () => {
    const { refreshRange, upsertEvents } = renderModal();
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
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 20, 2026/i);
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/every mon/i);
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
      expect(screen.queryByTestId("calendar-recurrence-section")).toBeNull();
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create recurring event/i);
    });

    fireEvent.click(getActiveRepeatTrigger(/repeat/i));
    const repeatPicker = await screen.findByRole("dialog", { name: /recurrence picker/i });
    expect(repeatPicker).toBeTruthy();
    fireEvent.change(within(repeatPicker).getByTestId("calendar-recurrence-frequency"), {
      target: { value: "monthly" },
    });
    fireEvent.change(within(repeatPicker).getByTestId("calendar-recurrence-interval"), {
      target: { value: "2" },
    });
    fireEvent.change(within(repeatPicker).getByTestId("calendar-recurrence-ends-type"), {
      target: { value: "onDate" },
    });
    fireEvent.click(await within(repeatPicker).findByTestId("calendar-recurrence-until-date"));
    fireEvent.click(within(await screen.findByLabelText("Recurrence end date picker")).getByRole("button", { name: "24" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Recurrence end date picker")).toBeNull();
      expect(within(repeatPicker).getByTestId("calendar-recurrence-until-date").textContent).toMatch(/apr 24, 2026/i);
    });

    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(refreshRange).toHaveBeenCalledWith("2026-04-20", "2026-04-20");
      expect(upsertEvents).not.toHaveBeenCalled();
    });
  });

  it("keeps the editor open when selecting a recurrence ends option from the floating listbox", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work at 3am to 8am every monday" },
    });

    fireEvent.click(getActiveRepeatTrigger(/repeat/i));
    const repeatPicker = await screen.findByRole("dialog", { name: /recurrence picker/i });
    const recurrenceSection = within(repeatPicker).getByTestId("calendar-recurrence-section");
    expect(recurrenceSection).toBeTruthy();

    fireEvent.click(within(recurrenceSection).getByRole("button", { name: /^never$/i }));
    const endsListbox = screen.getByRole("listbox", { name: /select option/i });
    expect(endsListbox).toBeTruthy();

    fireEvent.click(within(endsListbox).getByRole("option", { name: /on date/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(within(repeatPicker).getByTestId("calendar-recurrence-ends-type").value).toBe("onDate");
      expect(within(repeatPicker).getByTestId("calendar-recurrence-until-date")).toBeTruthy();
    });

    fireEvent.click(within(repeatPicker).getByTestId("calendar-recurrence-until-date"));
    fireEvent.click(within(await screen.findByLabelText("Recurrence end date picker")).getByRole("button", { name: "25" }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.queryByLabelText("Recurrence end date picker")).toBeNull();
      expect(within(repeatPicker).getByTestId("calendar-recurrence-until-date").textContent).toMatch(/apr 25, 2026/i);
    });
  });

  it("applies parsed title changes while editing an existing event", async () => {
    const { upsertEvents } = renderModal({
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

    await openFloatingEventEditorFromSelectedChip();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner on Apr 21 at 5pm" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-event-end-date").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/5:00 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/5:30 pm/i);
    });

    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockUpdateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
        id: "event-edit-nlp",
        title: "Dinner",
      }));
    });
  });

  it("sends the original calendar when moving an edited event to another calendar", async () => {
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
          ],
        },
        {
          accountId: "gmail-alt",
          accountLabel: "Alt Google",
          accountEmail: "alt@example.com",
          calendars: [
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
    mockUpdateCalendarEvent.mockResolvedValue({
      event: {
        id: "event-move",
        title: "Planning",
        accountId: "gmail-main",
        calendarId: "school",
        startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-21T16:30:00.000Z").getTime(),
        writable: true,
        allDay: false,
      },
    });

    const { upsertEvents } = renderModal({
      events: [
        {
          id: "event-move",
          etag: '"etag-move"',
          title: "Planning",
          accountId: "gmail-main",
          calendarId: "primary",
          startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
          endMs: new Date("2026-04-21T16:30:00.000Z").getTime(),
          writable: true,
          allDay: false,
        },
      ],
    });

    await openFloatingEventEditorFromSelectedChip();

    fireEvent.click(getActiveEventSourceTrigger());
    expect(await screen.findByRole("dialog", { name: /calendar source picker/i })).toBeTruthy();
    expect(screen.queryByText("Work")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /School/i }));
    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockUpdateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
        id: "event-move",
        calendarId: "school",
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

    fireEvent.click(await screen.findByRole("button", { name: /^McDonald's 123 Main St/i }));

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

  it("edits date ranges, all-day state, and overnight times from the compact schedule picker", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-date"));
    await screen.findByRole("dialog", { name: /compact schedule picker/i });
    fireEvent.click(within(screen.getByRole("dialog", { name: /compact schedule picker/i })).getByRole("button", { name: "22" }));
    await waitFor(() => {
      expect(within(screen.getByRole("dialog", { name: /compact schedule picker/i })).getByRole("button", { name: /end date/i }).getAttribute("aria-pressed")).toBe("true");
    });

    fireEvent.click(within(screen.getByRole("dialog", { name: /compact schedule picker/i })).getByRole("button", { name: "23" }));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/apr 22, 2026/i);
      expect(screen.getByTestId("calendar-event-end-date").textContent).toMatch(/apr 23, 2026/i);
    });

    fireEvent.click(within(screen.getByRole("dialog", { name: /compact schedule picker/i })).getByLabelText("All day"));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/all day/i);
      expect(within(screen.getByRole("dialog", { name: /compact schedule picker/i })).queryByRole("button", { name: /start time/i })).toBeNull();
    });

    fireEvent.click(within(screen.getByRole("dialog", { name: /compact schedule picker/i })).getByLabelText("All day"));
    setCompactSchedulePickerTime(
      screen.getByRole("dialog", { name: /compact schedule picker/i }),
      "start time",
      { hour: 11, minute: 45, period: "pm" },
    );
    setCompactSchedulePickerTime(
      screen.getByRole("dialog", { name: /compact schedule picker/i }),
      "end time",
      { hour: 12, minute: 15, period: "am" },
    );

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/11:45 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/12:15 am/i);
      expect(screen.getByTestId("calendar-event-end-date").textContent).toMatch(/apr 23, 2026/i);
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
      expect(screen.getByRole("button", { name: /McDonald's South El Monte/i })).toBeTruthy();
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
      expect(screen.getByTestId("calendar-event-source-trigger").getAttribute("aria-label")).toMatch(/school/i);
      expect(screen.getByTestId("calendar-event-title").value).toBe("Dinner 2pm ");
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/2:00 pm/i);
    });
  });

  it("saves with mod+enter", async () => {
    const { upsertEvents } = renderModal();
    const savedEvent = {
      id: "event-hotkey",
      title: "Planning block",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      allDay: false,
    };
    mockCreateCalendarEvent.mockResolvedValue({
      event: savedEvent,
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
      expect(upsertEvents).toHaveBeenCalledWith(savedEvent);
    });
  });

  it("keeps the current month after saving an event on a visible trailing day", async () => {
    renderModal({ focusDate: "2026-05-02" });
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        id: "event-trailing-day",
        title: "Planning block",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-06-01T16:00:00.000Z").getTime(),
        endMs: new Date("2026-06-01T16:30:00.000Z").getTime(),
        writable: true,
        allDay: false,
      },
    });

    expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });
    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalled();
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
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
    const { upsertEvents } = renderModal();
    const savedEvent = {
      id: "event-equal-time",
      title: "Hold",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      writable: true,
      allDay: false,
    };
    mockCreateCalendarEvent.mockResolvedValue({
      event: savedEvent,
    });

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Hold" },
    });

    fireEvent.click(screen.getByTestId("calendar-event-end-time"));
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    setCompactSchedulePickerTime(picker, "end time", { hour: 9, minute: 0, period: "am" });
    fireEvent.click(within(picker).getByRole("button", { name: /done/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-validation")).toBeNull();
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(upsertEvents).toHaveBeenCalledWith(savedEvent);
    });
  });
});
