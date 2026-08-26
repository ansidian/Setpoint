import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import DigestStrip from "./DigestStrip";

afterEach(() => {
  cleanup();
});

function renderStrip(liveLoading = false, extraProps: Partial<ComponentProps<typeof DigestStrip>> = {}) {
  render(
    <DigestStrip
      accent="#cba6da"
      counts={{ action: 2, fyi: 1, noise: 3 }}
      liveLoading={liveLoading}
      summary="Brief summary"
      onJumpLane={vi.fn()}
      {...extraProps}
    />,
  );
}

describe("DigestStrip", () => {
  it("shows the current inbox state when idle", () => {
    renderStrip();

    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Inbox · current");
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("No pending triage");
  });

  it("shows inbox syncing while retrieval is in flight", () => {
    renderStrip(true);

    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Inbox · syncing");
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Retrieving inbox state");
  });

  it("uses active snapshot language while triage sync is in flight", () => {
    renderStrip(true, {
      activeSnapshotMode: true,
      accountCount: 2,
      processingCount: 4,
    });

    expect(screen.getByText("Active snapshot")).toBeTruthy();
    expect(screen.getByText("6 emails across 2 accounts. 2 need attention, 1 FYI, 3 noise.")).toBeTruthy();
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Triage · syncing");
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("4 messages processing");
    expect(screen.queryByText("Briefing snapshot")).toBeNull();
    expect(screen.getByTestId("digest-live-slot").textContent).not.toContain("Retrieving live mail");
  });

  it("treats visible queued lane messages as current instead of syncing", () => {
    renderStrip(false, {
      activeSnapshotMode: true,
      accountCount: 2,
      counts: { queued: 3, action: 2, fyi: 1, noise: 3 },
      processingCount: 0,
    });

    const status = screen.getByTestId("digest-live-slot").textContent;
    expect(status).toContain("Triage · current");
    expect(status).toContain("3 messages visible in Queue");
    expect(status).not.toContain("Triage · syncing");
    expect(status).not.toContain("processing");
  });

  it("shows one adjacent control on current and both directions on history", () => {
    const onNavigate = vi.fn();
    const snapshot = {
      id: 2,
      snapshot_item_id: 2,
      status: "frozen" as const,
      schedule_label: "Morning",
      start_at: new Date(Date.now() - 86_400_000).toISOString(),
      end_at: new Date(Date.now() - 82_800_000).toISOString(),
      timezone: "America/Los_Angeles",
    };

    const { rerender } = render(
      <DigestStrip
        accent="#cba6da"
        counts={{ action: 2, fyi: 1, noise: 3 }}
        activeSnapshotMode
        snapshotNavigation={{
          snapshot: { ...snapshot, id: 3, status: "active" },
          canOlder: true,
          canNewer: false,
          historyLoading: false,
          navigating: null,
          error: null,
          onNavigate,
        }}
        onJumpLane={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Show older snapshot" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show newer snapshot" })).toBeNull();

    rerender(
      <DigestStrip
        accent="#cba6da"
        counts={{ action: 2, fyi: 1, noise: 3 }}
        activeSnapshotMode
        readOnly
        snapshotNavigation={{
          snapshot,
          canOlder: true,
          canNewer: true,
          historyLoading: false,
          navigating: null,
          error: null,
          onNavigate,
        }}
        onJumpLane={vi.fn()}
      />,
    );

    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Morning");
    fireEvent.click(screen.getByRole("button", { name: "Show older snapshot" }));
    fireEvent.click(screen.getByRole("button", { name: "Show newer snapshot" }));
    // test-architecture: allow-boundary-interaction -- this callback is the digest control's outward navigation boundary; the parent owns the resulting snapshot render.
    expect(onNavigate).toHaveBeenNthCalledWith(1, "older");
    // test-architecture: allow-boundary-interaction -- this callback is the digest control's outward navigation boundary; the parent owns the resulting snapshot render.
    expect(onNavigate).toHaveBeenNthCalledWith(2, "newer");
  });

  it("keeps the older control disabled at the oldest snapshot", () => {
    renderStrip(false, {
      activeSnapshotMode: true,
      readOnly: true,
      snapshotNavigation: {
        snapshot: null,
        canOlder: false,
        canNewer: true,
        historyLoading: false,
        navigating: null,
        error: null,
        onNavigate: vi.fn(),
      },
    });

    expect((screen.getByRole("button", { name: "Show older snapshot" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Show newer snapshot" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
