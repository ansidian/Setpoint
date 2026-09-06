import { describe, expect, it } from "vitest";
import {
  overflowStateIsLiveInScope,
  resolveOverflowPresentation
} from "./calendarGridUtils";

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
