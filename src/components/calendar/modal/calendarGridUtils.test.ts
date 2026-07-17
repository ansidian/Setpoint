import { describe, expect, it } from "vitest";
import {
  CURRENT_MONTH_BOUNDARY_COLOR,
  OTHER_MONTH_BOUNDARY_COLOR,
  buildCalendarMonthCells,
  overflowStateIsLiveInScope,
  resolveOverflowPresentation,
} from "./calendarGridUtils";
import type { CalendarRectLike } from "./calendarFloatingDetailPlacement";

describe("buildCalendarMonthCells", () => {
  it("labels trailing first-of-month days and marks boundaries around the actual current month", () => {
    const cells = buildCalendarMonthCells({
      cellCount: 42,
      currentMonth: 4,
      currentYear: 2026,
      firstDay: 3,
      viewMonth: 3,
      viewYear: 2026,
    });

    const may1 = cells.find((cell) => cell.dateKey === "2026-05-01");
    const may2 = cells.find((cell) => cell.dateKey === "2026-05-02");
    const march31 = cells.find((cell) => cell.dateKey === "2026-03-31");

    expect(may1).toMatchObject({
      dateLabel: "May 1",
      inCurrentMonth: false,
      inActualCurrentMonth: true,
      adjacentPosition: "trailing",
      boundaryColor: CURRENT_MONTH_BOUNDARY_COLOR,
    });
    expect(may1!.boundarySides).toEqual(["left", "top"]);
    expect(may2).toMatchObject({
      dateLabel: "2",
      boundaryColor: CURRENT_MONTH_BOUNDARY_COLOR,
    });
    expect(may2!.boundarySides).toEqual(["top"]);
    expect(march31).toMatchObject({
      dateLabel: "31",
      adjacentPosition: "leading",
      boundaryColor: OTHER_MONTH_BOUNDARY_COLOR,
    });
    expect(march31!.boundarySides).toEqual(["right", "bottom"]);
  });

  it("mutes adjacent-month boundaries that do not wrap the actual current month", () => {
    const cells = buildCalendarMonthCells({
      cellCount: 42,
      currentMonth: 3,
      currentYear: 2026,
      firstDay: 1,
      viewMonth: 5,
      viewYear: 2026,
    });

    const may31 = cells.find((cell) => cell.dateKey === "2026-05-31");

    expect(may31).toMatchObject({
      dateLabel: "31",
      inActualCurrentMonth: false,
      adjacentPosition: "leading",
      boundaryColor: OTHER_MONTH_BOUNDARY_COLOR,
    });
    expect(may31!.boundarySides).toEqual(["right", "bottom"]);
  });
});

describe("overflowStateIsLiveInScope", () => {
  it("rejects overflow state whose month or DOM anchors are stale", () => {
    const triggerElement = document.createElement("button");
    const sourceCellElement = document.createElement("div");
    document.body.append(triggerElement, sourceCellElement);
    const scope = { view: "events", viewYear: 2026, viewMonth: 4 };

    expect(overflowStateIsLiveInScope({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      mode: "inline",
      inlineAnchor: { top: 0, left: 0, width: 200 },
      triggerElement,
      sourceCellElement,
    }, scope)).toBe(true);

    expect(overflowStateIsLiveInScope({
      view: "events",
      viewYear: 2026,
      viewMonth: 5,
      mode: "inline",
      inlineAnchor: { top: 0, left: 0, width: 200 },
      triggerElement,
      sourceCellElement,
    }, scope)).toBe(false);

    sourceCellElement.remove();

    expect(overflowStateIsLiveInScope({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      mode: "inline",
      inlineAnchor: { top: 0, left: 0, width: 200 },
      triggerElement,
      sourceCellElement,
    }, scope)).toBe(false);

    triggerElement.remove();
  });

  it("keeps inline overflow live after its trigger is replaced by the external layer", () => {
    const triggerElement = document.createElement("button");
    const sourceCellElement = document.createElement("div");
    document.body.append(triggerElement, sourceCellElement);
    const scope = { view: "events", viewYear: 2026, viewMonth: 4 };

    triggerElement.remove();

    expect(overflowStateIsLiveInScope({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      mode: "inline",
      inlineAnchor: { top: 0, left: 0, width: 200 },
      triggerElement,
      sourceCellElement,
    }, scope)).toBe(true);

    sourceCellElement.remove();

    expect(overflowStateIsLiveInScope({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      mode: "inline",
      inlineAnchor: { top: 0, left: 0, width: 200 },
      triggerElement,
      sourceCellElement,
    }, scope)).toBe(false);
  });

  it("rejects fallback overflow after its trigger disconnects", () => {
    const triggerElement = document.createElement("button");
    const sourceCellElement = document.createElement("div");
    document.body.append(triggerElement, sourceCellElement);
    const scope = { view: "events", viewYear: 2026, viewMonth: 4 };

    triggerElement.remove();

    expect(overflowStateIsLiveInScope({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      mode: "fallback",
      inlineAnchor: null,
      triggerElement,
      sourceCellElement,
    }, scope)).toBe(false);

    sourceCellElement.remove();
  });
});

describe("resolveOverflowPresentation", () => {
  function buildOverflowFixture({ withContainer = true } = {}) {
    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({
      top: 40, bottom: 580, left: 60, right: 760, width: 700, height: 540,
    } as DOMRect);

    const trigger = document.createElement("button");
    trigger.getBoundingClientRect = () => ({
      top: 100, bottom: 128, left: 220, right: 340, width: 120, height: 28,
    } as DOMRect);

    container.append(trigger);
    document.body.append(container);

    return {
      trigger,
      container: withContainer ? container : null,
      cleanup: () => container.remove(),
    };
  }

  function attachMonthBlock(fixture: ReturnType<typeof buildOverflowFixture>, rect: CalendarRectLike): void {
    const monthBlock = document.createElement("div");
    monthBlock.setAttribute("data-month-block", "");
    monthBlock.getBoundingClientRect = () => rect as DOMRect;
    monthBlock.append(fixture.trigger);
    fixture.container!.append(monthBlock);
  }

  it("uses inline overflow on desktop layout", () => {
    const fixture = buildOverflowFixture();

    expect(resolveOverflowPresentation({
      triggerElement: fixture.trigger,
      layout: { stacked: false },
      containerElement: fixture.container,
    })).toEqual({
      mode: "inline",
      inlineAnchor: { top: 60, left: 156, width: 128 },
    });

    fixture.cleanup();
  });

  it("carries the month boundary to the bottom edge when inline overflow crosses the month block", () => {
    const fixture = buildOverflowFixture();
    attachMonthBlock(fixture, {
      top: 40, bottom: 170, left: 60, right: 760, width: 700, height: 130,
    });

    expect(resolveOverflowPresentation({
      triggerElement: fixture.trigger,
      layout: { stacked: false },
      containerElement: fixture.container,
      hiddenItemCount: 3,
      boundaryColor: "#0095FF",
    })).toEqual({
      mode: "inline",
      inlineAnchor: { top: 60, left: 156, width: 128 },
      carryBoundaryToBottom: true,
      boundaryColor: "#0095FF",
    });

    fixture.cleanup();
  });

  it("does not carry the boundary when inline overflow stays inside the month block", () => {
    const fixture = buildOverflowFixture();
    attachMonthBlock(fixture, {
      top: 40, bottom: 360, left: 60, right: 760, width: 700, height: 320,
    });

    expect(resolveOverflowPresentation({
      triggerElement: fixture.trigger,
      layout: { stacked: false },
      containerElement: fixture.container,
      hiddenItemCount: 2,
      boundaryColor: "#0095FF",
    })).toEqual({
      mode: "inline",
      inlineAnchor: { top: 60, left: 156, width: 128 },
      carryBoundaryToBottom: false,
      boundaryColor: "#0095FF",
    });

    fixture.cleanup();
  });

  it("falls back on stacked (mobile) layout", () => {
    const fixture = buildOverflowFixture();

    expect(resolveOverflowPresentation({
      triggerElement: fixture.trigger,
      layout: { stacked: true },
      containerElement: fixture.container,
    })).toEqual({ mode: "fallback", inlineAnchor: null });

    fixture.cleanup();
  });

  it("returns null when the inline anchor cannot be resolved", () => {
    const fixture = buildOverflowFixture({ withContainer: false });

    expect(resolveOverflowPresentation({
      triggerElement: fixture.trigger,
      layout: { stacked: false },
      containerElement: fixture.container,
    })).toBeNull();

    fixture.cleanup();
  });
});
