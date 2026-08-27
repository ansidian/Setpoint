import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopSnapshotNavigator from "./DesktopSnapshotNavigator";

afterEach(() => {
  cleanup();
});

const snapshot = {
  id: 2,
  snapshot_item_id: 2,
  status: "frozen" as const,
  schedule_label: "Morning",
  start_at: "2026-08-25T15:00:00.000Z",
  end_at: "2026-08-25T19:00:00.000Z",
  timezone: "America/Los_Angeles",
};

describe("DesktopSnapshotNavigator", () => {
  it("keeps historical navigation beside useful window context", () => {
    const onNavigate = vi.fn();
    render(
      <DesktopSnapshotNavigator
        navigation={{
          snapshot,
          canOlder: true,
          canNewer: true,
          newerIsCurrent: true,
          historyLoading: false,
          navigating: null,
          error: null,
          onNavigate,
        }}
        liveLoading={false}
        processingCount={0}
        readOnly
      />,
    );

    expect(screen.getByText(/Morning/)).toBeTruthy();
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show older snapshot" }));
    fireEvent.click(screen.getByRole("button", { name: "Show current snapshot" }));
    // test-architecture: allow-boundary-interaction -- the navigator forwards the user's adjacent-snapshot choice to its owning history controller.
    expect(onNavigate).toHaveBeenNthCalledWith(1, "older");
    // test-architecture: allow-boundary-interaction -- the navigator forwards the user's adjacent-snapshot choice to its owning history controller.
    expect(onNavigate).toHaveBeenNthCalledWith(2, "newer");
  });

  it("only announces triage activity while an update is running", () => {
    const { rerender } = render(
      <DesktopSnapshotNavigator
        navigation={null}
        liveLoading
        processingCount={4}
        readOnly={false}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("Updating 4");
    expect(screen.queryByText(/No pending triage/i)).toBeNull();

    rerender(
      <DesktopSnapshotNavigator
        navigation={null}
        liveLoading={false}
        processingCount={0}
        readOnly={false}
      />,
    );

    expect(screen.queryByTestId("desktop-snapshot-navigator")).toBeNull();
  });

  it("keeps the forward label as newer for an intermediate historical target", () => {
    render(
      <DesktopSnapshotNavigator
        navigation={{
          snapshot,
          canOlder: true,
          canNewer: true,
          newerIsCurrent: false,
          historyLoading: false,
          navigating: null,
          error: null,
          onNavigate: vi.fn(),
        }}
        liveLoading={false}
        processingCount={0}
        readOnly
      />,
    );

    expect(screen.getByRole("button", { name: "Show newer snapshot" }).textContent).toContain("Newer");
  });

  it("does not restate generic status in the window context", () => {
    render(
      <DesktopSnapshotNavigator
        navigation={{
          snapshot: { ...snapshot, status: "active", schedule_label: null },
          canOlder: true,
          canNewer: false,
          historyLoading: false,
          navigating: null,
          error: null,
          onNavigate: vi.fn(),
        }}
        liveLoading={false}
        processingCount={0}
        readOnly={false}
      />,
    );

    expect(screen.getByTestId("desktop-snapshot-navigator").textContent).not.toContain("Current");
  });
});
