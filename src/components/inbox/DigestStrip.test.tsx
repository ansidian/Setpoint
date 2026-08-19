import { cleanup, render, screen } from "@testing-library/react";
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
});
