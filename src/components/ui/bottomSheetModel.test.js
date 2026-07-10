import { describe, it, expect } from "vitest";
import { findScrollableParent, shouldDismissOnDragEnd, shouldEngageDrag } from "./bottomSheetModel.js";

describe("findScrollableParent", () => {
  it("returns the nearest ancestor with overflow-y auto/scroll and real overflow", () => {
    const boundary = document.createElement("div");
    const scroller = document.createElement("div");
    const child = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 200, configurable: true });
    boundary.appendChild(scroller);
    scroller.appendChild(child);
    document.body.appendChild(boundary);

    expect(findScrollableParent(child, boundary)).toBe(scroller);

    boundary.remove();
  });

  it("falls back to the boundary when no scrollable ancestor is found", () => {
    const boundary = document.createElement("div");
    const child = document.createElement("div");
    boundary.appendChild(child);
    document.body.appendChild(boundary);

    expect(findScrollableParent(child, boundary)).toBe(boundary);

    boundary.remove();
  });

  it("skips an ancestor with overflow-y auto but no actual overflow (scrollHeight === clientHeight)", () => {
    const boundary = document.createElement("div");
    const notScrollable = document.createElement("div");
    const child = document.createElement("div");
    notScrollable.style.overflowY = "auto";
    Object.defineProperty(notScrollable, "scrollHeight", { value: 200, configurable: true });
    Object.defineProperty(notScrollable, "clientHeight", { value: 200, configurable: true });
    boundary.appendChild(notScrollable);
    notScrollable.appendChild(child);
    document.body.appendChild(boundary);

    expect(findScrollableParent(child, boundary)).toBe(boundary);

    boundary.remove();
  });
});

describe("shouldDismissOnDragEnd", () => {
  it("is false at the default threshold boundary (100)", () => {
    expect(shouldDismissOnDragEnd(100)).toBe(false);
  });

  it("is true just past the default threshold (101)", () => {
    expect(shouldDismissOnDragEnd(101)).toBe(true);
  });
});

describe("shouldEngageDrag", () => {
  it("is true when there is no scroll container", () => {
    expect(shouldEngageDrag(null)).toBe(true);
  });

  it("is true when the scroll container is at scrollTop 0", () => {
    expect(shouldEngageDrag({ scrollTop: 0 })).toBe(true);
  });

  it("is false when the scroll container has scrolled down", () => {
    expect(shouldEngageDrag({ scrollTop: 5 })).toBe(false);
  });
});
