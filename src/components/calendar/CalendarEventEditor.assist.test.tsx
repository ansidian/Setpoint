import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockGetCalendarSources, mockCreateCalendarEvent, mockUpdateCalendarEvent, mockGetCalendarPlaceSuggestions, mockGetCalendarPlaceDetails } from "./CalendarEventEditor.test-setup.ts";
import { renderModal } from "./CalendarEventEditor.test-utils.tsx";
import {
  commitTitleWithoutWallClock,
  getActiveEventSaveButton,
  getActiveEventSourceTrigger,
  renderEventEditor,
  setCompactSchedulePickerTime,
} from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor source and location assist behavior", () => {
  it("opens the create editor before calendar sources finish loading", async () => {
    let resolveSources: ((value: unknown) => void) | undefined;
    mockGetCalendarSources.mockReturnValue(new Promise((resolve) => {
      resolveSources = resolve;
    }));
    renderEventEditor();

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect((screen.getByTestId("calendar-event-source") as HTMLInputElement).value).toBe("");
    // test-architecture: allow-boundary-interaction -- Calendar sources are fetched from the server; exact-once loading protects against duplicate provider reads while the editor opens eagerly.
    expect(mockGetCalendarSources).toHaveBeenCalledTimes(1);

    resolveSources?.({
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
      expect((screen.getByTestId("calendar-event-source") as HTMLInputElement).value).toBe("gmail-main::primary");
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

    const event = {
      id: "event-move",
      etag: '"etag-move"',
      title: "Planning",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T16:30:00.000Z").getTime(),
      writable: true,
      allDay: false,
    };
    renderEventEditor({ event });
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(getActiveEventSourceTrigger());
    expect(await screen.findByRole("dialog", { name: /calendar source picker/i })).toBeTruthy();
    expect(screen.queryByText("Work")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /School/i }));
    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Moving across calendars requires original and target identities plus the etag on the outbound Calendar request; the saved event contains only the target.
      expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-move", expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "school",
        sourceAccountId: "gmail-main",
        sourceCalendarId: "primary",
        etag: '"etag-move"',
      }));
      expect(screen.getByTestId("calendar-editor-observed-upserts").textContent).toContain('"calendarId":"school"');
    });
  });

  it("shows location suggestions and resolves a selected place into the location field", async () => {
    renderEventEditor();
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

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.focus(screen.getByTestId("calendar-event-location"));
    fireEvent.input(screen.getByTestId("calendar-event-location"), {
      target: { value: "McDonald's" },
    });

    // The suggestion dropdown renders after a debounced fetch; the default 1s
    // findBy timeout flakes under full-suite worker load.
    fireEvent.click(await screen.findByRole("button", { name: /^McDonald's 123 Main St/i }, { timeout: 5000 }));

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-location") as HTMLInputElement).value).toBe("McDonald's, 123 Main St, Los Angeles, CA 90012, USA");
    });
  });

  it("lets the user arrow through location suggestions and press enter to commit one", async () => {
    renderEventEditor();
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
      expect((screen.getByTestId("calendar-event-location") as HTMLInputElement).value).toBe("McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA");
    });
  });

  it("edits date ranges, all-day state, and overnight times from the compact schedule picker", async () => {
    renderEventEditor();
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
    renderEventEditor();
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

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    const titleInput = screen.getByTestId("calendar-event-title");
    fireEvent.input(titleInput, {
      target: { value: "Dinner 5pm @McDonald's" },
    });

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-location") as HTMLInputElement).value).toBe("McDonald's");
      expect(screen.getByRole("button", { name: /McDonald's South El Monte/i })).toBeTruthy();
    });

    fireEvent.keyDown(titleInput, { key: "ArrowDown" });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-location") as HTMLInputElement).value).toBe("McDonald's El Monte, 456 Valley Blvd, El Monte, CA 91731, USA");
      expect((screen.getByTestId("calendar-event-title") as HTMLInputElement).value).toBe("Dinner 5pm ");
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/5:00 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/5:30 pm/i);
    });
  });

  it("resolves an unconsumed @location token through Places when the event is saved directly", async () => {
    renderEventEditor();
    mockGetCalendarPlaceSuggestions.mockResolvedValue({
      places: [
        {
          placeId: "place-cc",
          primaryText: "C&C Collision",
          secondaryText: "800 W Main St, Alhambra, CA 91801, USA",
          fullText: "C&C Collision, 800 W Main St, Alhambra, CA 91801, USA",
        },
      ],
    });
    mockGetCalendarPlaceDetails.mockResolvedValue({
      place: {
        placeId: "place-cc",
        displayName: "C&C Collision",
        formattedAddress: "800 W Main St, Alhambra, CA 91801, USA",
        location: "C&C Collision, 800 W Main St, Alhambra, CA 91801, USA",
      },
    });
    mockCreateCalendarEvent.mockResolvedValue({ event: { id: "new-place-event" } });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Body shop visit 5pm @C&C Collision alhambra");

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-location") as HTMLInputElement).value).toBe("C&C Collision alhambra");
      expect(screen.getByText("800 W Main St, Alhambra, CA 91801, USA")).toBeTruthy();
    }, { timeout: 5000 });

    // Save without explicitly accepting the suggestion — the active suggestion
    // must still be resolved so Google gets the full place, not the raw token.
    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Saving an unaccepted Places suggestion must send the resolved address, not the visible raw token, across the outbound Calendar API boundary.
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
        location: "C&C Collision, 800 W Main St, Alhambra, CA 91801, USA",
      }));
    }, { timeout: 5000 });
  });

  it("keeps the resolved place when details arrive slower than the title debounce", async () => {
    renderEventEditor();
    mockGetCalendarPlaceSuggestions.mockResolvedValue({
      places: [
        {
          placeId: "place-cc",
          primaryText: "C&C Collision",
          secondaryText: "800 W Main St, Alhambra, CA 91801, USA",
          fullText: "C&C Collision, 800 W Main St, Alhambra, CA 91801, USA",
        },
      ],
    });
    // Hold details past the 120ms title debounce so the stale @token re-parse
    // runs first without paying for a second real-time settling window.
    let resolvePlaceDetails: ((value: unknown) => void) | undefined;
    mockGetCalendarPlaceDetails.mockImplementation(
      () => new Promise((resolve) => {
        resolvePlaceDetails = resolve;
      }),
    );
    const placeDetails = {
        place: {
          placeId: "place-cc",
          displayName: "C&C Collision",
          formattedAddress: "800 W Main St, Alhambra, CA 91801, USA",
          location: "C&C Collision, 800 W Main St, Alhambra, CA 91801, USA",
        },
      };

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    const titleInput = screen.getByTestId("calendar-event-title");
    fireEvent.input(titleInput, {
      target: { value: "Body shop visit 5pm @C&C Collision alhambra" },
    });

    await waitFor(() => {
      expect(screen.getByText("800 W Main St, Alhambra, CA 91801, USA")).toBeTruthy();
    }, { timeout: 5000 });

    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => expect(resolvePlaceDetails).toBeTypeOf("function"));
    resolvePlaceDetails?.(placeDetails);

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-location") as HTMLInputElement).value)
        .toBe("C&C Collision, 800 W Main St, Alhambra, CA 91801, USA");
    }, { timeout: 5000 });
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
    renderEventEditor();
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    const titleInput = screen.getByTestId("calendar-event-title");
    commitTitleWithoutWallClock("Dinner 2pm cal school");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title-source-preview").textContent).toMatch(/school/i);
      expect(screen.getByLabelText("Calendar source picker")).toBeTruthy();
      expect(screen.getByText("School")).toBeTruthy();
    });

    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-source-trigger").getAttribute("aria-label")).toMatch(/school/i);
      expect((screen.getByTestId("calendar-event-title") as HTMLInputElement).value).toBe("Dinner 2pm ");
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/2:00 pm/i);
    });
  });

  it("saves with mod+enter", async () => {
    renderEventEditor();
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

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Planning block");

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- The hotkey requirement includes the complete outbound Calendar payload; cache/UI state cannot reveal omitted request fields.
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Planning block",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "09:00",
        endTime: "09:30",
      }));
      expect(screen.getByTestId("calendar-editor-observed-upserts").textContent).toContain(savedEvent.id);
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
      expect((screen.getByTestId("calendar-event-save") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
  });

});
