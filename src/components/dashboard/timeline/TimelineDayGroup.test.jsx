import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TimelineDayGroup from "./TimelineDayGroup.jsx";

afterEach(() => {
  cleanup();
});

describe("TimelineDayGroup", () => {
  it("keeps the today marker stable across parent rerenders", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const event = {
      kind: "event",
      startMs: new Date("2026-05-05T20:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T21:00:00.000Z").getTime(),
      data: {
        id: "focus",
        title: "Focus block",
        startMs: new Date("2026-05-05T20:00:00.000Z").getTime(),
        endMs: new Date("2026-05-05T21:00:00.000Z").getTime(),
      },
    };

    const { rerender } = render(
      <TimelineDayGroup
        accent="#cba6da"
        day={0}
        isFirst
        items={[event]}
        now={now}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("timeline-now-marker")).toBeTruthy();

    rerender(
      <TimelineDayGroup
        accent="#cba6da"
        day={0}
        isFirst
        items={[{ ...event }]}
        now={now}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("timeline-now-marker")).toBeTruthy();
  });
});
