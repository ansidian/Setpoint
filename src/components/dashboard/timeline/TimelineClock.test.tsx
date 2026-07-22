import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineClock } from "./TimelineClock";

afterEach(cleanup);

describe("TimelineClock", () => {
  it("renders leading-hour-free 12-hour Pacific times", () => {
    for (const [instant, expected, rejected] of [
      ["2026-03-06T21:18:00.000Z", /1:18 ?\s?PM/, /01:18/],
      ["2026-03-06T17:05:00.000Z", /9:05 ?\s?AM/, /09:05/],
    ] as const) {
      const view = render(<TimelineClock now={new Date(instant).getTime()} />);
      const text = screen.getByTestId("timeline-clock").textContent;
      expect(text).toMatch(expected);
      expect(text).not.toMatch(rejected);
      view.unmount();
    }
  });
});
