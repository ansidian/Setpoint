import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TimelineDayGroup from "./TimelineDayGroup";

describe("TimelineDayGroup", () => {
  afterEach(() => cleanup());

  it("explains an empty current-day rail instead of rendering only its spine", () => {
    render(
      <TimelineDayGroup
        day={0}
        items={[]}
        now={Date.parse("2026-08-01T16:00:00.000Z")}
        accent="#cba6da"
        isFirst
      />,
    );

    expect(screen.getByText("Today is clear")).toBeTruthy();
    expect(screen.getByText("No events or deadlines scheduled.")).toBeTruthy();
  });
});
