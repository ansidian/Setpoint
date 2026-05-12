import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DigestStrip from "./DigestStrip.jsx";

afterEach(() => {
  cleanup();
});

function renderStrip(liveCount, liveLoading = false, extraProps = {}) {
  render(
    <DigestStrip
      accent="#cba6da"
      counts={{ action: 2, fyi: 1, noise: 3 }}
      liveCount={liveCount}
      liveLoading={liveLoading}
      summary="Brief summary"
      onJumpLane={vi.fn()}
      {...extraProps}
    />,
  );
}

describe("DigestStrip", () => {
  it("keeps the live slot rendered when there is no live mail", () => {
    renderStrip(0);

    expect(screen.getByTestId("digest-live-slot").textContent).toContain("No new live mail");
  });

  it("shows live counts without changing the slot structure", () => {
    renderStrip(4);

    expect(screen.getByText("Inbox snapshot")).toBeTruthy();
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("4");
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Live");
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("not yet triaged");
  });

  it("shows the live retrieval state while the poll is in flight", () => {
    renderStrip(0, true);

    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Live · checking");
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Retrieving live mail");
  });

  it("uses active snapshot language while triage sync is in flight", () => {
    renderStrip(0, true, {
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
    renderStrip(0, false, {
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
