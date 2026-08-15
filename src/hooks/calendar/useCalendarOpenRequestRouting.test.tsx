import { createRef } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCalendarOpenRequestRouting from "./useCalendarOpenRequestRouting";
import type { CalendarEventCreateRequest } from "./calendarEventCreateBridge";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCalendarOpenRequestRouting first-attempt readiness", () => {
  it("retries transient editor unavailability before acknowledging the request", async () => {
    const onAcknowledged = vi.fn();
    const eventCreateRequest: CalendarEventCreateRequest = {
      seed: {
        title: "Test Event",
        allDay: false,
        startDate: "2026-08-15",
        startTime: "15:00",
        endTime: "16:00",
      },
      origin: { kind: "alfred-proposal", referenceId: "proposal-1" },
      onAcknowledged,
    };
    const openFloatingEventCreate = vi.fn()
      .mockResolvedValueOnce({ accepted: false, reason: "editor_unavailable" })
      .mockResolvedValueOnce({ accepted: true });

    renderHook(() => useCalendarOpenRequestRouting({
      request: {
        open: true,
        view: "events",
        openRequestId: 1,
        focusDate: "2026-08-15",
        focusItemId: "new",
        forceDeadlineOverlay: false,
        usesFloatingEditor: true,
        activeSelectedDateKey: "2026-08-15",
        todayDateKey: "2026-08-15",
        eventCreateRequest,
      },
      syncSnapshot: null,
      commitSyncSnapshot: () => {},
      clearAgendaScrollCommand: () => {},
      editors: {
        eventEditorEditable: true,
        closeEventEditor: () => {},
        openEventCreate: vi.fn(),
        openFloatingEventCreate,
        openFloatingDeadlineCreate: () => {},
        setDeadlineEditor: vi.fn(),
        setDeadlineDraftPreview: vi.fn(),
      },
      floating: {
        detailRef: createRef(),
        setDetail: vi.fn(),
      },
    }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- The owner callback is the stable bridge boundary proving the first Review request settled as accepted.
      expect(onAcknowledged).toHaveBeenCalledWith({ status: "accepted", origin: eventCreateRequest.origin });
    });
    // test-architecture: allow-boundary-interaction -- The transient readiness retry is observable only at the editor-open boundary.
    expect(openFloatingEventCreate).toHaveBeenCalledTimes(2);
  });

  it("does not retry a terminal seed rejection", async () => {
    const onAcknowledged = vi.fn();
    const eventCreateRequest: CalendarEventCreateRequest = {
      seed: { title: "Invalid seed", allDay: false, startDate: "2026-08-15", startTime: "15:00" },
      origin: { kind: "alfred-proposal", referenceId: "proposal-2" },
      onAcknowledged,
    };
    const openFloatingEventCreate = vi.fn().mockResolvedValue({ accepted: false, reason: "seed_rejected" });

    renderHook(() => useCalendarOpenRequestRouting({
      request: {
        open: true, view: "events", openRequestId: 2, focusDate: "2026-08-15", focusItemId: "new",
        forceDeadlineOverlay: false, usesFloatingEditor: true, activeSelectedDateKey: "2026-08-15",
        todayDateKey: "2026-08-15", eventCreateRequest,
      },
      syncSnapshot: null,
      commitSyncSnapshot: () => {},
      clearAgendaScrollCommand: () => {},
      editors: {
        eventEditorEditable: true,
        closeEventEditor: () => {},
        openEventCreate: vi.fn(),
        openFloatingEventCreate,
        openFloatingDeadlineCreate: () => {},
        setDeadlineEditor: vi.fn(),
        setDeadlineDraftPreview: vi.fn(),
      },
      floating: { detailRef: createRef(), setDetail: vi.fn() },
    }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- The owner callback is the stable bridge boundary for a terminal seed rejection.
      expect(onAcknowledged).toHaveBeenCalledWith({
        status: "failed",
        origin: eventCreateRequest.origin,
        reason: "seed_rejected",
      });
    });
    // test-architecture: allow-boundary-interaction -- A terminal editor result must not be reissued across the editor-open boundary.
    expect(openFloatingEventCreate).toHaveBeenCalledTimes(1);
  });
});
