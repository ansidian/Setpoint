import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarFloatingDetailPanel from "./CalendarFloatingDetailPanel";
import { resolveFloatingDetailPlacement } from "./calendarFloatingDetailPlacement";
import type { FloatingDetailSide } from "./calendarFloatingDetailPlacement";
import type { HTMLAttributes, ReactNode } from "react";

type MotionTestProps = HTMLAttributes<HTMLDivElement> & {
  animate?: { opacity?: unknown; x?: unknown; y?: unknown };
  children?: ReactNode;
  exit?: unknown;
  initial?: unknown;
  transition?: {
    x?: { duration?: unknown; type?: unknown };
    y?: { duration?: unknown; type?: unknown };
  };
  whileDrag?: unknown;
  whileHover?: unknown;
  whileTap?: unknown;
};

vi.mock("motion/react", async () => {
  const React = await import("react");
  const MotionDiv = React.forwardRef(function MotionDiv({
    animate,
    children,
    exit: _exit,
    initial,
    transition,
    whileDrag: _whileDrag,
    whileHover: _whileHover,
    whileTap: _whileTap,
    ...props
  }: MotionTestProps, ref: React.ForwardedRef<HTMLDivElement>) {
    return React.createElement("div", {
      ...props,
      ref,
      "data-motion-initial": JSON.stringify(initial ?? null),
      "data-motion-animate-opacity": animate?.opacity ?? "",
      "data-motion-animate-x": animate?.x ?? "",
      "data-motion-animate-y": animate?.y ?? "",
      "data-motion-transition-x-duration": transition?.x?.duration ?? "",
      "data-motion-transition-x-type": transition?.x?.type ?? "",
      "data-motion-transition-y-duration": transition?.y?.duration ?? "",
      "data-motion-transition-y-type": transition?.y?.type ?? "",
    }, children);
  });

  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => React.createElement(React.Fragment, null, children),
    motion: { div: MotionDiv },
    useReducedMotion: () => false,
  };
});

type TestResizeCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
let resizeCallback: TestResizeCallback = () => {};
let originalResizeObserver: typeof globalThis.ResizeObserver;
let testElements: HTMLElement[] = [];

interface TestRect {
  width?: number;
  height?: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function domRect(rect: TestRect): DOMRect {
  return DOMRect.fromRect({
    x: rect.left,
    y: rect.top,
    width: rect.width ?? rect.right - rect.left,
    height: rect.height ?? rect.bottom - rect.top,
  });
}

function appendRectElement(rect: TestRect): HTMLDivElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = vi.fn(() => domRect(rect));
  document.body.appendChild(element);
  testElements.push(element);
  return element;
}

async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
}

describe("CalendarFloatingDetailPanel", () => {
  beforeEach(() => {
    resizeCallback = () => {};
    testElements = [];
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = (entries) => callback(entries as unknown as ResizeObserverEntry[], this);
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    testElements.forEach((element) => element.remove());
    testElements = [];
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("renders the Motion shell with initial={false} so a revealed panel survives an Activity tab re-show", () => {
    // Regression guard: the panel is a document.body portal inside the calendar's
    // Activity-frozen KeepAliveTab. A non-false `initial` (e.g. {opacity:0,
    // scale:0.985}) is re-applied by Motion on tab re-show WITHOUT re-running the
    // enter animation (the `animate` target is unchanged), pinning the panel at
    // opacity 0 — invisible yet hit-testable. The awaiting gate already supplies
    // the faded/scaled-down start via `animate`, so `initial` must stay false.
    const anchorElement = appendRectElement({
      top: 400, left: 600, right: 700, bottom: 424, width: 100, height: 24,
    });
    const detail = {
      open: true,
      mode: "detail",
      placementKey: "reveal-survives-1",
      view: "events",
      itemId: "evt-1",
      dateKey: "2026-06-09",
      anchorElement,
      sourceCellElement: null,
      exclusionElement: null,
      preferredSide: "left",
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: null,
        exclusionRect: null,
        calendarRect: null,
        railRect: null,
        panelHeight: 300,
        mode: "detail",
        preferredSide: "left",
      }),
    };

    render(
      <CalendarFloatingDetailPanel
        detail={detail}
        label="Event"
        calendarPanelRef={{ current: null }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Work</div>
      </CalendarFloatingDetailPanel>,
    );

    expect(
      screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-initial"),
    ).toBe("false");
  });

  it("waits for the first measured placement before revealing, then keeps later repositioning animated", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const anchorElement = appendRectElement({
      top: 400,
      left: 600,
      right: 700,
      bottom: 424,
      width: 100,
      height: 24,
    });
    const calendarPanelRef = { current: calendarPanel };
    const detail = {
      open: true,
      mode: "detail",
      placementKey: "bill-placement-1",
      view: "bills",
      itemId: "bill-1",
      dateKey: "2026-04-20",
      anchorElement,
      sourceCellElement: null,
      exclusionElement: null,
      preferredSide: "left",
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: null,
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 300,
        mode: "detail",
        preferredSide: "left",
      }),
    };

    render(
      <CalendarFloatingDetailPanel
        detail={detail}
        label="Bills"
        calendarPanelRef={calendarPanelRef}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Rent</div>
      </CalendarFloatingDetailPanel>,
    );

    const panel = screen.getByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-motion-animate-opacity")).toBe("0");
    expect(panel.getAttribute("data-motion-transition-y-duration")).toBe("0.01");
    expect(Number(panel.getAttribute("data-motion-animate-y"))).toBe(detail.initialPlacement.top);

    // Synchronous act: flush the resize-driven reveal + snap state, but leave the
    // snap-clearing requestAnimationFrame pending. happy-dom drains rAF callbacks
    // inside act(async () => ...) (jsdom does not), which would prematurely clear the
    // snap before this assertion. The explicit nextFrame() below clears it on schedule.
    act(() => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });

    const snappedPanel = screen.getByTestId("calendar-floating-detail-panel");
    expect(snappedPanel.getAttribute("data-motion-animate-opacity")).toBe("1");
    expect(Number(snappedPanel.getAttribute("data-motion-animate-y"))).toBeGreaterThan(detail.initialPlacement.top);
    expect(snappedPanel.getAttribute("data-motion-transition-y-duration")).toBe("0.01");

    await nextFrame();

    await act(async () => {
      resizeCallback([{ contentRect: { height: 240, width: 380 } }]);
    });

    const animatedPanel = screen.getByTestId("calendar-floating-detail-panel");
    expect(animatedPanel.getAttribute("data-motion-transition-y-type")).toBe("spring");
  });

  it("does not stay hidden when the first resize entry reports the initial zero height", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const anchorElement = appendRectElement({
      top: 400,
      left: 600,
      right: 700,
      bottom: 424,
      width: 100,
      height: 24,
    });
    const detail = {
      open: true,
      mode: "detail",
      placementKey: "bill-placement-zero",
      view: "bills",
      itemId: "bill-1",
      dateKey: "2026-04-20",
      anchorElement,
      sourceCellElement: null,
      exclusionElement: null,
      preferredSide: "left",
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: null,
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 300,
        mode: "detail",
        preferredSide: "left",
      }),
    };

    render(
      <CalendarFloatingDetailPanel
        detail={detail}
        label="Bills"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
      <div>Rent</div>
      </CalendarFloatingDetailPanel>,
    );

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-opacity")).toBe("0");

    await act(async () => {
      resizeCallback([{ contentRect: { height: 0, width: 380 } }]);
    });

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-opacity")).toBe("1");
  });

  // The invariant for the three anchor-loss tests below comes from
  // CONTEXT.md: scrolling or losing the anchor never moves, parks,
  // dismisses, or re-anchors an open detail panel — it stays where it is.
  it("keeps a search-result-row anchored panel in place when the anchor element disconnects", async () => {
    const calendarPanel = appendRectElement({
      top: 0, left: 0, right: 900, bottom: 900, width: 900, height: 900,
    });
    const rail = appendRectElement({
      top: 80, left: 580, right: 880, bottom: 860, width: 300, height: 780,
    });
    const anchorElement = appendRectElement({
      top: 100, left: 200, right: 400, bottom: 120, width: 200, height: 20,
    });
    const detail = {
      open: true,
      mode: "detail",
      anchorElement,
      anchorKind: "search-result-row",
      placementKey: "test-search",
      view: "events",
      itemId: "event-search-1",
      dateKey: "2026-05-14",
      sourceCellElement: null,
      exclusionElement: null,
      preferredSide: null,
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: anchorElement.getBoundingClientRect(),
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: rail.getBoundingClientRect(),
        panelHeight: 300,
        mode: "detail",
      }),
    };

    const { rerender } = render(
      <CalendarFloatingDetailPanel
        detail={detail}
        label="Search"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: rail }}
        onClose={() => {}}
      >
        <div>Content</div>
      </CalendarFloatingDetailPanel>,
    );

    await act(async () => {
      resizeCallback([{ contentRect: { height: 200, width: 380 } }]);
    });
    const placedPanel = screen.getByTestId("calendar-floating-detail-panel");
    const placedX = placedPanel.getAttribute("data-motion-animate-x");
    const placedY = placedPanel.getAttribute("data-motion-animate-y");

    anchorElement.remove();

    rerender(
      <CalendarFloatingDetailPanel
        detail={{ ...detail, anchorElement }}
        label="Search"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: rail }}
        onClose={() => {}}
      >
        <div>Content</div>
      </CalendarFloatingDetailPanel>,
    );

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const panel = screen.getByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-motion-animate-x")).toBe(placedX);
    expect(panel.getAttribute("data-motion-animate-y")).toBe(placedY);
  });

  it("keeps an agenda-anchored panel in place during transient row replacement", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const anchorElement = appendRectElement({
      top: 400,
      left: 600,
      right: 700,
      bottom: 424,
      width: 100,
      height: 24,
    });

    render(
      <CalendarFloatingDetailPanel
        detail={{
          open: true,
          mode: "edit",
          placementKey: "agenda-placement",
          view: "events",
          itemId: "event-1",
          dateKey: "2026-05-12",
          anchorElement,
          sourceCellElement: anchorElement,
          anchorKind: "agenda-row",
          preferredSide: "left",
          sideIntent: "auto",
          userDragged: false,
          initialPlacement: resolveFloatingDetailPlacement({
            anchorRect: anchorElement.getBoundingClientRect(),
            sourceRect: anchorElement.getBoundingClientRect(),
            calendarRect: calendarPanel.getBoundingClientRect(),
            railRect: null,
            panelHeight: 560,
            mode: "edit",
            preferredSide: "left",
          }),
        }}
        label="Event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Editor</div>
      </CalendarFloatingDetailPanel>,
    );

    const placedY = screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-y");

    anchorElement.remove();
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    const panel = screen.getByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-motion-animate-y")).toBe(placedY);
  });

  it("keeps a grid-anchored detail in place while a connected anchor has transient outside geometry", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const anchorElement = appendRectElement({
      top: 180,
      left: -28,
      right: -4,
      bottom: 208,
      width: 24,
      height: 28,
    });

    render(
      <CalendarFloatingDetailPanel
        detail={{
          open: true,
          mode: "detail",
          placementKey: "sunday-reanchor-placement",
          view: "events",
          itemId: "event-1",
          dateKey: "2026-04-19",
          anchorElement,
          sourceCellElement: anchorElement,
          anchorKind: "chip",
          preferredSide: null,
          sideIntent: "auto",
          userDragged: false,
          initialPlacement: resolveFloatingDetailPlacement({
            anchorRect: anchorElement.getBoundingClientRect(),
            sourceRect: anchorElement.getBoundingClientRect(),
            calendarRect: calendarPanel.getBoundingClientRect(),
            railRect: null,
            panelHeight: 300,
            mode: "detail",
          }),
        }}
        label="Event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Detail</div>
      </CalendarFloatingDetailPanel>,
    );

    const placedY = screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-y");

    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    const panels = screen.getAllByTestId("calendar-floating-detail-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.getAttribute("data-motion-animate-y")).toBe(placedY);
  });

  it("snaps cold side flips until the first measured placement is revealed", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const anchorElement = appendRectElement({
      top: 400,
      left: 380,
      right: 420,
      bottom: 424,
      width: 40,
      height: 24,
    });
    const makeDetail = ({ forcedSide = null, sideIntent = "auto" }: {
      forcedSide?: FloatingDetailSide | null;
      sideIntent?: string;
    } = {}) => ({
      open: true,
      mode: "detail",
      placementKey: "event-placement-cold-flip",
      view: "events",
      itemId: "event-1",
      dateKey: "2026-04-20",
      anchorElement,
      sourceCellElement: anchorElement,
      exclusionElement: null,
      anchorKind: "chip",
      preferredSide: null,
      forcedSide,
      sideIntent,
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: anchorElement.getBoundingClientRect(),
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 300,
        mode: "detail",
        forcedSide,
        allowRailOverlap: sideIntent === "user-flip",
      }),
    });

    const { rerender } = render(
      <CalendarFloatingDetailPanel
        detail={makeDetail()}
        label="Event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Design review</div>
      </CalendarFloatingDetailPanel>,
    );

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-opacity")).toBe("0");

    rerender(
      <CalendarFloatingDetailPanel
        detail={makeDetail({ forcedSide: "left", sideIntent: "user-flip" })}
        label="Event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Design review</div>
      </CalendarFloatingDetailPanel>,
    );

    const coldFlippedPanel = screen.getByTestId("calendar-floating-detail-panel");
    expect(coldFlippedPanel.getAttribute("data-motion-animate-opacity")).toBe("0");
    expect(coldFlippedPanel.getAttribute("data-motion-transition-x-duration")).toBe("0.01");
    expect(coldFlippedPanel.getAttribute("data-motion-transition-y-duration")).toBe("0.01");

    // Synchronous act keeps the snap-clearing rAF pending (see note in the first
    // measured-placement test) so the cold-flip snap is still observable here; happy-dom
    // would otherwise drain that rAF inside act(async) and clear the snap early.
    act(() => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });

    const revealedPanel = screen.getByTestId("calendar-floating-detail-panel");
    expect(revealedPanel.getAttribute("data-motion-animate-opacity")).toBe("1");
    expect(revealedPanel.getAttribute("data-motion-transition-x-duration")).toBe("0.01");
    expect(revealedPanel.getAttribute("data-motion-transition-y-duration")).toBe("0.01");

    await nextFrame();

    rerender(
      <CalendarFloatingDetailPanel
        detail={makeDetail()}
        label="Event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Design review</div>
      </CalendarFloatingDetailPanel>,
    );

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-transition-x-type")).toBe("spring");
  });

  it("does not reuse the first reveal snap when the user flips after the panel is visible", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const anchorElement = appendRectElement({
      top: 400,
      left: 380,
      right: 420,
      bottom: 424,
      width: 40,
      height: 24,
    });
    const makeDetail = ({ forcedSide = null, sideIntent = "auto" }: {
      forcedSide?: FloatingDetailSide | null;
      sideIntent?: string;
    } = {}) => ({
      open: true,
      mode: "detail",
      placementKey: "event-placement-visible-flip",
      view: "events",
      itemId: "event-1",
      dateKey: "2026-04-20",
      anchorElement,
      sourceCellElement: anchorElement,
      exclusionElement: null,
      anchorKind: "chip",
      preferredSide: null,
      forcedSide,
      sideIntent,
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: anchorElement.getBoundingClientRect(),
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 300,
        mode: "detail",
        forcedSide,
        allowRailOverlap: sideIntent === "user-flip",
      }),
    });

    const { rerender } = render(
      <CalendarFloatingDetailPanel
        detail={makeDetail()}
        label="Event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Design review</div>
      </CalendarFloatingDetailPanel>,
    );

    // Synchronous act keeps the snap-clearing rAF pending (see note in the first
    // measured-placement test) so the first-reveal snap is observable; happy-dom would
    // otherwise drain that rAF inside act(async) and clear the snap before this assertion.
    act(() => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-opacity")).toBe("1");
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-transition-x-duration")).toBe("0.01");

    rerender(
      <CalendarFloatingDetailPanel
        detail={makeDetail({ forcedSide: "left", sideIntent: "user-flip" })}
        label="Event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Design review</div>
      </CalendarFloatingDetailPanel>,
    );

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-transition-x-type")).toBe("spring");
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-transition-y-type")).toBe("spring");
  });

  it("keeps chip-to-chip repositions visible after the panel has measured once", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const firstAnchor = appendRectElement({
      top: 400,
      left: 600,
      right: 700,
      bottom: 424,
      width: 100,
      height: 24,
    });
    const secondAnchor = appendRectElement({
      top: 620,
      left: 260,
      right: 360,
      bottom: 644,
      width: 100,
      height: 24,
    });
    const makeDetail = (placementKey: string, anchorElement: HTMLElement) => ({
      open: true,
      mode: "detail",
      placementKey,
      view: "bills",
      itemId: "bill-1",
      dateKey: "2026-04-20",
      anchorElement,
      sourceCellElement: null,
      exclusionElement: null,
      preferredSide: "left",
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: null,
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 220,
        mode: "detail",
        preferredSide: "left",
      }),
    });

    const { rerender } = render(
      <CalendarFloatingDetailPanel
        detail={makeDetail("bill-placement-1", firstAnchor)}
        label="Bills"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>Rent</div>
      </CalendarFloatingDetailPanel>,
    );

    await act(async () => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });
    await nextFrame();

    rerender(
      <CalendarFloatingDetailPanel
        detail={makeDetail("bill-placement-2", secondAnchor)}
        label="Bills"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <div>SCE</div>
      </CalendarFloatingDetailPanel>,
    );

    const movedPanel = screen.getByTestId("calendar-floating-detail-panel");
    expect(movedPanel.getAttribute("data-motion-animate-opacity")).toBe("1");
    expect(movedPanel.getAttribute("data-motion-transition-y-type")).toBe("spring");

    await act(async () => {
      resizeCallback([{ contentRect: { height: 240, width: 380 } }]);
    });

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-transition-y-type")).toBe("spring");
  });

  it("keeps editor placement stable when content height changes while typing", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const anchorElement = appendRectElement({
      top: 400,
      left: 600,
      right: 700,
      bottom: 424,
      width: 100,
      height: 24,
    });
    const detail = {
      open: true,
      mode: "create",
      placementKey: "event-editor-placement",
      view: "events",
      itemId: "new-event",
      dateKey: "2026-05-17",
      anchorElement,
      sourceCellElement: anchorElement,
      exclusionElement: null,
      anchorKind: "day-cell",
      preferredSide: null,
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: anchorElement.getBoundingClientRect(),
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 560,
        mode: "create",
      }),
    };

    render(
      <CalendarFloatingDetailPanel
        detail={detail}
        label="New event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <label>
          Title
          <input data-testid="calendar-event-title" defaultValue="" />
        </label>
      </CalendarFloatingDetailPanel>,
    );

    await act(async () => {
      resizeCallback([{ contentRect: { height: 561, width: 420 } }]);
    });
    const initialY = Number(
      screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-y"),
    );

    await act(async () => {
      resizeCallback([{ contentRect: { height: 562, width: 420 } }]);
    });

    expect(Number(
      screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-y"),
    )).toBe(initialY);
  });

  it("keeps an anchored editor fixed in place when scrolling moves the anchor away", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const dayCell = appendRectElement({
      top: -80,
      left: 120,
      right: 240,
      bottom: 220,
      width: 120,
      height: 300,
    });
    const dateAnchor = appendRectElement({
      top: -18,
      left: 132,
      right: 156,
      bottom: 6,
      width: 24,
      height: 24,
    });
    dateAnchor.setAttribute("data-calendar-day-cell-anchor", "true");
    dayCell.appendChild(dateAnchor);
    const detail = {
      open: true,
      mode: "create",
      placementKey: "event-editor-day-cell-anchor",
      view: "events",
      itemId: "new-event",
      dateKey: "2026-05-17",
      anchorElement: dayCell,
      sourceCellElement: dayCell,
      exclusionElement: null,
      anchorKind: "day-cell",
      preferredSide: null,
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: dayCell.getBoundingClientRect(),
        sourceRect: dayCell.getBoundingClientRect(),
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 560,
        mode: "create",
      }),
    };

    render(
      <CalendarFloatingDetailPanel
        detail={detail}
        label="New event"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
      >
        <label>
          Title
          <input data-testid="calendar-event-title" defaultValue="" />
        </label>
      </CalendarFloatingDetailPanel>,
    );

    await act(async () => {
      resizeCallback([{ contentRect: { height: 561, width: 420 } }]);
    });
    const initialY = Number(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-y"));

    dayCell.getBoundingClientRect = vi.fn(() => domRect({
      top: -400,
      left: 120,
      right: 240,
      bottom: -100,
      width: 120,
      height: 300,
    }));
    dateAnchor.getBoundingClientRect = vi.fn(() => domRect({
      top: -338,
      left: 132,
      right: 156,
      bottom: -314,
      width: 24,
      height: 24,
    }));

    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(Number(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-y"))).toBe(initialY);
  });

  function renderDraggable(onUserDraggedChange: (dragged: boolean, placementKey: string) => void) {
    const calendarPanel = appendRectElement({
      top: 0, left: 0, right: 900, bottom: 900, width: 900, height: 900,
    });
    const anchorElement = appendRectElement({
      top: 400, left: 600, right: 700, bottom: 424, width: 100, height: 24,
    });
    const detail = {
      open: true,
      mode: "detail",
      placementKey: "drag-placement-1",
      view: "bills",
      itemId: "bill-1",
      dateKey: "2026-04-20",
      anchorElement,
      sourceCellElement: null,
      exclusionElement: null,
      preferredSide: "left",
      forcedSide: null,
      sideIntent: "auto",
      userDragged: false,
      initialPlacement: resolveFloatingDetailPlacement({
        anchorRect: anchorElement.getBoundingClientRect(),
        sourceRect: null,
        exclusionRect: null,
        calendarRect: calendarPanel.getBoundingClientRect(),
        railRect: null,
        panelHeight: 220,
        mode: "detail",
        preferredSide: "left",
      }),
    };
    render(
      <CalendarFloatingDetailPanel
        detail={detail}
        label="Bills"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: null }}
        onClose={() => {}}
        onUserDraggedChange={onUserDraggedChange}
      >
        <div>Rent</div>
      </CalendarFloatingDetailPanel>,
    );
    return detail;
  }

  it("commits a manual drag: moves the panel and reports the user-dragged placement", async () => {
    const onUserDraggedChange = vi.fn();
    const detail = renderDraggable(onUserDraggedChange);

    await act(async () => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });
    await nextFrame();

    // Give the panel a non-zero origin so the pointer-down offset capture
    // (clientX - panelRect.left) actually bites and is pinned by the assertions below.
    const panel = screen.getByTestId("calendar-floating-detail-panel");
    panel.getBoundingClientRect = vi.fn(() => domRect({
      top: 20, left: 40, right: 420, bottom: 240, width: 380, height: 220,
    }));

    const handle = screen.getByTestId("calendar-floating-detail-drag-handle");
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      // Past the 2px threshold, so this is treated as a drag, not a click.
      fireEvent.pointerMove(handle, { clientX: 300, clientY: 260, pointerId: 1 });
    });
    await nextFrame();
    act(() => {
      fireEvent.pointerUp(handle, { clientX: 300, clientY: 260, pointerId: 1 });
    });

    // offset = (downX - panelLeft, downY - panelTop) = (60, 80); manual pos =
    // (moveX - offsetX, moveY - offsetY) = (240, 180), both inside the calendar.
    expect(Number(panel.getAttribute("data-motion-animate-x"))).toBe(240);
    expect(Number(panel.getAttribute("data-motion-animate-y"))).toBe(180);
    // A manual drag snaps instantly (no spring) and drops the caret.
    expect(panel.getAttribute("data-motion-transition-x-duration")).toBe("0.01");
    expect(onUserDraggedChange).toHaveBeenCalledWith(true, detail.placementKey);
  });

  it("treats an exactly-2px move as a drag (threshold is inclusive of 2)", async () => {
    const onUserDraggedChange = vi.fn();
    const detail = renderDraggable(onUserDraggedChange);

    await act(async () => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });
    await nextFrame();

    const handle = screen.getByTestId("calendar-floating-detail-drag-handle");
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      // hypot(2, 0) === 2.0 — `< 2` lets this through as a drag; `<= 2` would not.
      fireEvent.pointerMove(handle, { clientX: 102, clientY: 100, pointerId: 1 });
    });
    await nextFrame();
    act(() => {
      fireEvent.pointerUp(handle, { clientX: 102, clientY: 100, pointerId: 1 });
    });

    expect(onUserDraggedChange).toHaveBeenCalledWith(true, detail.placementKey);
  });

  it("treats a movement just past the 2px threshold as a drag", async () => {
    const onUserDraggedChange = vi.fn();
    const detail = renderDraggable(onUserDraggedChange);

    await act(async () => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });
    await nextFrame();

    const handle = screen.getByTestId("calendar-floating-detail-drag-handle");
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      // 3px > the 2px threshold — the smallest motion that still counts as a drag.
      fireEvent.pointerMove(handle, { clientX: 103, clientY: 100, pointerId: 1 });
    });
    await nextFrame();
    act(() => {
      fireEvent.pointerUp(handle, { clientX: 103, clientY: 100, pointerId: 1 });
    });

    expect(onUserDraggedChange).toHaveBeenCalledWith(true, detail.placementKey);
  });

  it("does not commit a sub-threshold pointer interaction as a drag", async () => {
    const onUserDraggedChange = vi.fn();
    renderDraggable(onUserDraggedChange);

    await act(async () => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });
    await nextFrame();

    const placedX = screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-x");
    const handle = screen.getByTestId("calendar-floating-detail-drag-handle");
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      // Below the 2px movement threshold — a click, not a drag.
      fireEvent.pointerMove(handle, { clientX: 100.5, clientY: 100.5, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: 100.5, clientY: 100.5, pointerId: 1 });
    });

    expect(onUserDraggedChange).not.toHaveBeenCalled();
    // The panel stays on its anchored placement.
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-x")).toBe(placedX);
  });
});
