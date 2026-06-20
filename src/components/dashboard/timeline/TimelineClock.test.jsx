import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineClock } from "./TimelineClock.jsx";

afterEach(cleanup);

describe("TimelineClock", () => {
  it("renders a 12-hour Pacific time for the given instant", () => {
    const now = new Date("2026-03-06T21:18:00.000Z").getTime(); // 1:18 PM PST
    render(<TimelineClock now={now} />);
    expect(screen.getByTestId("timeline-clock").textContent).toMatch(/1:18 ?\s?PM/);
  });

  it("uses a leading-hour-free 12h format (no 01:18)", () => {
    const now = new Date("2026-03-06T17:05:00.000Z").getTime(); // 9:05 AM PST
    render(<TimelineClock now={now} />);
    const text = screen.getByTestId("timeline-clock").textContent;
    expect(text).toMatch(/9:05/);
    expect(text).not.toMatch(/09:05/);
  });
});
