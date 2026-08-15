import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  mockCreateCalendarEvent,
  mockGetCalendarSources,
} from "./CalendarEventEditor.test-setup.ts";
import {
  getActiveEventSaveButton,
  createDeferred,
  renderEventEditor,
} from "./events/CalendarEventEditor.test-utils.tsx";
import type { CalendarEventCreateRequest } from "../../hooks/calendar/calendarEventCreateBridge.ts";

function createRequest(overrides: Partial<CalendarEventCreateRequest> = {}): CalendarEventCreateRequest {
  return {
    seed: {
      title: "Dinner Friday 5pm @Parsed Place",
      allDay: false,
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      startTime: "14:00",
      endTime: "15:15",
      location: "Seeded Place",
      description: "Bring the agenda",
      source: { kind: "resolved", accountId: "gmail-main", calendarId: "work" },
    },
    origin: { kind: "test", referenceId: "proposal-1" },
    ...overrides,
  };
}

describe("CalendarEventEditor create-seed bridge", () => {
  it("keeps a requested calendar unresolved until sources return, then selects one exact writable match", async () => {
    const sources = createDeferred<{ accounts: Array<Record<string, unknown>> }>();
    mockGetCalendarSources.mockReturnValue(sources.promise);

    renderEventEditor({ createRequest: createRequest({
      seed: {
        title: "Team planning",
        allDay: false,
        startDate: "2026-09-10",
        startTime: "09:00",
        endTime: "09:30",
        source: { kind: "requested", calendarName: "Work" },
      },
    }) });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-source-trigger").getAttribute("aria-label"))
      .toMatch(/loading calendars/i);

    sources.resolve({
      accounts: [{
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [
          { id: "primary", summary: "Personal", writable: true, primary: true },
          { id: "work", summary: "Work", writable: true, primary: false },
        ],
      }],
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-source-trigger").getAttribute("aria-label")).toMatch(/work/i);
    });
  });

  it("prefills the full editable seed without title assistance replacing structured values", async () => {
    mockGetCalendarSources.mockResolvedValue({
      accounts: [{
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [
          { id: "primary", summary: "Personal", writable: true, primary: true },
          { id: "work", summary: "Work", writable: true, primary: false },
        ],
      }],
    });

    renderEventEditor({ createRequest: createRequest() });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-title") as HTMLInputElement).value)
        .toBe("Dinner Friday 5pm @Parsed Place");
      expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/sep 10, 2026/i);
      expect(screen.getByTestId("calendar-event-end-date").textContent).toMatch(/sep 10, 2026/i);
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/2:00 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/3:15 pm/i);
      expect((screen.getByTestId("calendar-event-location") as HTMLInputElement).value).toBe("Seeded Place");
      expect((screen.getByTestId("calendar-event-description") as HTMLTextAreaElement).value).toBe("Bring the agenda");
      expect(screen.getByTestId("calendar-event-source-trigger").getAttribute("aria-label")).toMatch(/work/i);
    });

    fireEvent.input(screen.getByTestId("calendar-event-description"), {
      target: { value: "Updated agenda" },
    });
    expect((screen.getByTestId("calendar-event-description") as HTMLTextAreaElement).value).toBe("Updated agenda");
  });

  it("returns the normalized saved event and unchanged origin once without serializing origin", async () => {
    const onCompleted = vi.fn();
    const request = createRequest({
      seed: {
        title: "Planning block",
        allDay: false,
        startDate: "2026-09-10",
        startTime: "09:00",
        endTime: "09:30",
      },
      onCompleted,
    });
    const savedEvent = {
      id: "normalized-event",
      etag: '"saved"',
      title: "Planning block",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-09-10T16:00:00.000Z").getTime(),
      endMs: new Date("2026-09-10T16:30:00.000Z").getTime(),
      writable: true,
      allDay: false,
    };
    mockCreateCalendarEvent.mockResolvedValue({ event: savedEvent });

    renderEventEditor({ createRequest: request });
    await screen.findByTestId("calendar-event-editor-rail");
    await waitFor(() => expect(getActiveEventSaveButton().disabled).toBe(false));
    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Completion is the bridge's outbound caller contract; rendered Calendar detail cannot expose delivery cardinality.
      expect(onCompleted).toHaveBeenCalledTimes(1);
      // test-architecture: allow-boundary-interaction -- The caller boundary must receive the exact normalized provider event and unchanged coordination origin.
      expect(onCompleted).toHaveBeenCalledWith({ event: savedEvent, origin: request.origin });
    });
    // test-architecture: allow-boundary-interaction -- Origin leakage is observable only at the outbound Calendar provider boundary; the rendered editor cannot prove coordination metadata was excluded from the request.
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.not.objectContaining({
      origin: expect.anything(),
      referenceId: expect.anything(),
    }));
    // test-architecture: allow-boundary-interaction -- The provider mutation facade is the stable boundary proving one editor commit produces exactly one write.
    expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the seeded editor for provider retry and emits no completion on failure or cancel", async () => {
    const onCompleted = vi.fn();
    mockCreateCalendarEvent.mockRejectedValueOnce(new Error("Provider unavailable"));

    renderEventEditor({ createRequest: createRequest({
      seed: {
        title: "Retry planning",
        allDay: false,
        startDate: "2026-09-10",
        startTime: "09:00",
        endTime: "09:30",
      },
      onCompleted,
    }) });
    await screen.findByTestId("calendar-event-editor-rail");
    await waitFor(() => expect(getActiveEventSaveButton().disabled).toBe(false));
    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(screen.getByText(/provider unavailable/i)).toBeTruthy();
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    });
    // test-architecture: allow-boundary-interaction -- Provider failure must remain inside Calendar and emit nothing across the external completion boundary.
    expect(onCompleted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull());
    // test-architecture: allow-boundary-interaction -- Cancel has no rendered substitute for proving the external completion boundary stayed silent.
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
