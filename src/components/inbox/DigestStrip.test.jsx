import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DigestStrip from "./DigestStrip.jsx";

afterEach(() => {
  cleanup();
});

function renderStrip(liveCount) {
  render(
    <DigestStrip
      accent="#cba6da"
      counts={{ action: 2, fyi: 1, noise: 3 }}
      liveCount={liveCount}
      summary="Brief summary"
      onJumpLane={vi.fn()}
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

    expect(screen.getByTestId("digest-live-slot").textContent).toContain("4");
    expect(screen.getByTestId("digest-live-slot").textContent).toContain("Live");
  });
});
