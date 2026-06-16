import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockGetCalendarSources, mockCreateCalendarEvent, mockUpdateCalendarEvent, mockGetCalendarPlaceSuggestions, mockGetCalendarPlaceDetails } from "./CalendarEventEditor.test-setup.js";
import { renderModal, openFloatingEventEditorFromSelectedChip, getActiveEventSourceTrigger, getActiveEventSaveButton, setCompactSchedulePickerTime } from "./CalendarEventEditor.test-utils.jsx";

describe("CalendarEventEditor source and location assist behavior", () => {
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

  it("checks the mapped event enum color for existing source-colored events", async () => {
    const event = {
      id: "event-context-source-color",
      etag: '"etag-context-source-color"',
      title: "Source color",
      accountId: "gmail-main",
      calendarId: "work",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
      sourceColor: "#4285f4",
      color: "#4285f4",
      colorId: null,
    };
    renderModal({ events: [event] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });

    const grape = await screen.findByTestId("calendar-event-color-9");
    await waitFor(() => {
      expect(document.activeElement).toBe(grape);
    });
    expect(grape.getAttribute("aria-label")).toBe("Blueberry");
    expect(grape.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("calendar-event-color-check-9")).toBeTruthy();
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
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    });
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
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

    // The suggestion dropdown renders after a debounced fetch; the default 1s
    // findBy timeout flakes under full-suite worker load.
    fireEvent.click(await screen.findByRole("button", { name: /^McDonald's 123 Main St/i }, { timeout: 5000 }));

    await waitFor(() => {
      expect(mockGetCalendarPlaceDetails).toHaveBeenCalledWith("place-1", expect.any(String));
      expect(screen.getByTestId("calendar-event-location").value).toBe("McDonald's, 123 Main St, Los Angeles, CA 90012, USA");
    });
  });

  it("lets the user arrow through location suggestions and press enter to commit one", async () => {
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
    fireEvent.keyDown(locationInput, { key: "ArrowDown" });
    fireEvent.keyDown(locationInput, { key: "Enter" });

    await waitFor(() => {
      expect(mockGetCalendarPlaceDetails).toHaveBeenCalledWith("place-2", expect.any(String));
      expect(screen.getByTestId("calendar-event-location").value).toBe("McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA");
    });
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
    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalled();
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
  });

});
