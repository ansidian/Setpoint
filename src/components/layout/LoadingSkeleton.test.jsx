import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LoadingSkeleton from "./LoadingSkeleton";

describe("LoadingSkeleton", () => {
  it("reserves the dashboard's three-tier first-paint geometry", () => {
    render(<LoadingSkeleton />);

    expect(screen.getByTestId("skeleton-band")).toBeTruthy();
    const timeline = screen.getByTestId("skeleton-timeline");
    expect(screen.getByTestId("skeleton-context")).toBeTruthy();
    expect(within(timeline).getAllByTestId("skeleton-timeline-row")).toHaveLength(6);
  });
});
