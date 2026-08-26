import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MobileSnapshotHeader from "./MobileSnapshotHeader";

afterEach(cleanup);

describe("MobileSnapshotHeader", () => {
  it("shows adjacent navigation and the window on a historical snapshot", () => {
    const onNavigate = vi.fn();
    render(
      <MobileSnapshotHeader
        accent="#cba6da"
        activeSnapshotMode
        readOnly
        summary="1 email across 1 account."
        noiseUnreadCount={0}
        snapshotNavigation={{
          snapshot: {
            id: 20,
            snapshot_item_id: 20,
            status: "frozen",
            schedule_label: "Morning",
            start_at: "2026-05-02T14:00:00.000Z",
            end_at: "2026-05-02T19:00:00.000Z",
            timezone: "America/Los_Angeles",
          },
          canOlder: true,
          canNewer: true,
          historyLoading: false,
          navigating: null,
          error: null,
          onNavigate,
        }}
      />,
    );

    expect(screen.getByText("Snapshot")).toBeTruthy();
    expect(screen.getByText(/Morning/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show newer snapshot" }));
    // test-architecture: allow-boundary-interaction -- the navigation callback is the component's outward state-transition boundary; no rendered state changes until its owner supplies the next snapshot.
    expect(onNavigate).toHaveBeenCalledWith("newer");
  });
});
