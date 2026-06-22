import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import useDeadlineOverlayState from "./useDeadlineOverlayState.js";

const DEADLINE_KEY = "calendar:eventsDeadlineOverlay";
const COMPLETED_KEY = "calendar:eventsCompletedDeadlines";

function renderOverlayState(props = {}) {
  return renderHook(
    (overrides) => useDeadlineOverlayState({
      open: true,
      view: "events",
      forceEventOverlay: false,
      forceDeadlineOverlay: false,
      forceCompletedDeadlineOverlay: false,
      openRequestId: 0,
      ...overrides,
    }),
    { initialProps: props },
  );
}

describe("useDeadlineOverlayState", () => {
  beforeEach(() => {
    window.localStorage.removeItem(DEADLINE_KEY);
    window.localStorage.removeItem(COMPLETED_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(DEADLINE_KEY);
    window.localStorage.removeItem(COMPLETED_KEY);
  });

  it("defaults the overlays on when no stored preference exists", () => {
    const { result } = renderOverlayState();
    expect(result.current.eventOverlayVisible).toBe(true);
    expect(result.current.deadlineOverlayVisible).toBe(true);
    expect(result.current.completedDeadlineOverlayVisible).toBe(true);
  });

  it("initializes the deadline flags from localStorage", () => {
    window.localStorage.setItem(DEADLINE_KEY, "false");
    window.localStorage.setItem(COMPLETED_KEY, "false");
    const { result } = renderOverlayState();
    expect(result.current.deadlineOverlayVisible).toBe(false);
    expect(result.current.completedDeadlineOverlayVisible).toBe(false);
    // The event overlay is session-only and always starts visible.
    expect(result.current.eventOverlayVisible).toBe(true);
  });

  it("persists the deadline overlay toggle so it survives a refresh", () => {
    const { result, unmount } = renderOverlayState();

    act(() => result.current.toggleDeadlineOverlay());
    expect(result.current.deadlineOverlayVisible).toBe(false);
    expect(window.localStorage.getItem(DEADLINE_KEY)).toBe("false");

    // Simulate a refresh: a fresh mount reads the stored "off" preference back.
    unmount();
    const { result: reloaded } = renderOverlayState();
    expect(reloaded.current.deadlineOverlayVisible).toBe(false);
  });

  it("persists the completed-deadline toggle", () => {
    const { result } = renderOverlayState();
    act(() => result.current.toggleCompletedDeadlineOverlay());
    expect(result.current.completedDeadlineOverlayVisible).toBe(false);
    expect(window.localStorage.getItem(COMPLETED_KEY)).toBe("false");
  });

  it("does not persist the event overlay toggle", () => {
    const { result } = renderOverlayState();
    act(() => result.current.toggleEventOverlay());
    expect(result.current.eventOverlayVisible).toBe(false);
    expect(window.localStorage.getItem("calendar:eventsEventOverlay")).toBeNull();
  });

  it("persists explicit deadline visibility writes from the keyboard path", () => {
    const { result } = renderOverlayState();
    act(() => result.current.setDeadlineOverlayVisible(false));
    expect(result.current.deadlineOverlayVisible).toBe(false);
    expect(window.localStorage.getItem(DEADLINE_KEY)).toBe("false");
  });

  it("forces a dashboard-requested overlay on without clobbering the stored preference", () => {
    // User had deadlines turned off; a dashboard deep-link forces them on for the open.
    window.localStorage.setItem(DEADLINE_KEY, "false");
    const { result, rerender } = renderOverlayState({
      open: true,
      forceDeadlineOverlay: true,
      openRequestId: 1,
    });

    expect(result.current.deadlineOverlayVisible).toBe(true);
    // Forcing must not overwrite the saved "off" choice.
    expect(window.localStorage.getItem(DEADLINE_KEY)).toBe("false");

    // Closing the modal restores the user's prior (off) preference.
    act(() => rerender({ open: false, forceDeadlineOverlay: true, openRequestId: 1 }));
    expect(result.current.deadlineOverlayVisible).toBe(false);
    expect(window.localStorage.getItem(DEADLINE_KEY)).toBe("false");
  });

  it("forces show-completed on for a dashboard deep-link, then restores the stored 'off' preference on leave", () => {
    // User keeps completed deadlines hidden; a dashboard deadline deep-link forces
    // them visible so the (completed) target is shown.
    window.localStorage.setItem(COMPLETED_KEY, "false");
    const { result, rerender } = renderOverlayState({
      open: true,
      forceCompletedDeadlineOverlay: true,
      openRequestId: 1,
    });

    expect(result.current.completedDeadlineOverlayVisible).toBe(true);
    // Forcing must not overwrite the saved "off" choice.
    expect(window.localStorage.getItem(COMPLETED_KEY)).toBe("false");

    // Leaving the calendar restores the prior (off) state.
    act(() => rerender({ open: false, forceCompletedDeadlineOverlay: true, openRequestId: 1 }));
    expect(result.current.completedDeadlineOverlayVisible).toBe(false);
    expect(window.localStorage.getItem(COMPLETED_KEY)).toBe("false");
  });

  it("leaves show-completed on after a deep-link when it was already on before", () => {
    // No stored preference => defaults on. A forced peek must not flip it off on leave.
    const { result, rerender } = renderOverlayState({
      open: true,
      forceCompletedDeadlineOverlay: true,
      openRequestId: 1,
    });
    expect(result.current.completedDeadlineOverlayVisible).toBe(true);

    act(() => rerender({ open: false, forceCompletedDeadlineOverlay: true, openRequestId: 1 }));
    expect(result.current.completedDeadlineOverlayVisible).toBe(true);
  });

  it("reverts a forced session to the pre-deep-link preference when the keep-alive tab is hidden (effect cleanup)", () => {
    // The calendar is a persistent tab, so `open` stays true for its lifetime;
    // React's <Activity> runs this hook's effect cleanup on tab-hide. Unmounting
    // exercises that same cleanup. A mid-session manual toggle is reverted to the
    // value captured before the dashboard force, proving the cleanup fired.
    window.localStorage.setItem(COMPLETED_KEY, "false"); // pre-force: hidden
    const { result, unmount } = renderOverlayState({
      open: true,
      forceCompletedDeadlineOverlay: true,
      openRequestId: 1,
    });
    expect(result.current.completedDeadlineOverlayVisible).toBe(true); // forced on

    act(() => result.current.toggleCompletedDeadlineOverlay()); // -> off, writes "false"
    act(() => result.current.toggleCompletedDeadlineOverlay()); // -> on, writes "true"
    expect(window.localStorage.getItem(COMPLETED_KEY)).toBe("true");

    unmount(); // tab hidden / left: cleanup restores the pre-deep-link preference
    expect(window.localStorage.getItem(COMPLETED_KEY)).toBe("false");
  });
});
