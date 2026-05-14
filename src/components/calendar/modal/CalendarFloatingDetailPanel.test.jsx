import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarFloatingDetailPanel from "./CalendarFloatingDetailPanel.jsx";
import { resolveFloatingDetailPlacement } from "./calendarFloatingDetailPlacement.js";

vi.mock("motion/react", async () => {
  const React = await import("react");
  const MotionDiv = React.forwardRef(function MotionDiv({
    animate,
    children,
    exit: _exit,
    initial: _initial,
    transition,
    whileDrag: _whileDrag,
    whileHover: _whileHover,
    whileTap: _whileTap,
    ...props
  }, ref) {
    return React.createElement("div", {
      ...props,
      ref,
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
    AnimatePresence: ({ children }) => React.createElement(React.Fragment, null, children),
    motion: { div: MotionDiv },
    useReducedMotion: () => false,
  };
});

let resizeCallback = null;
let originalResizeObserver = null;
let testElements = [];

function domRect(rect) {
  return {
    width: rect.width ?? rect.right - rect.left,
    height: rect.height ?? rect.bottom - rect.top,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function appendRectElement(rect) {
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
    resizeCallback = null;
    testElements = [];
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        resizeCallback = callback;
      }

      observe() {}

      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    testElements.forEach((element) => element.remove());
    testElements = [];
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete globalThis.ResizeObserver;
    }
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
      parked: false,
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
        onPark={() => {}}
        onClose={() => {}}
      >
        <div>Rent</div>
      </CalendarFloatingDetailPanel>,
    );

    const panel = screen.getByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-motion-animate-opacity")).toBe("0");
    expect(panel.getAttribute("data-motion-transition-y-duration")).toBe("0.01");
    expect(Number(panel.getAttribute("data-motion-animate-y"))).toBe(detail.initialPlacement.top);

    await act(async () => {
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
      parked: false,
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
        onPark={() => {}}
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

  it("keeps the first park animated while the initial measured snap is pending", async () => {
    const calendarPanel = appendRectElement({
      top: 0,
      left: 0,
      right: 900,
      bottom: 900,
      width: 900,
      height: 900,
    });
    const rail = appendRectElement({
      top: 80,
      left: 580,
      right: 880,
      bottom: 860,
      width: 300,
      height: 780,
    });
    const anchorElement = appendRectElement({
      top: 420,
      left: 120,
      right: 220,
      bottom: 444,
      width: 100,
      height: 24,
    });
    const detail = {
      open: true,
      mode: "detail",
      placementKey: "event-placement-first-park",
      view: "events",
      itemId: "event-1",
      dateKey: "2026-05-14",
      anchorElement,
      sourceCellElement: anchorElement,
      exclusionElement: null,
      preferredSide: null,
      forcedSide: null,
      sideIntent: "auto",
      parked: false,
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
        label="Events"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: rail }}
        onPark={() => {}}
        onClose={() => {}}
      >
        <div>Wash Car</div>
      </CalendarFloatingDetailPanel>,
    );

    await act(async () => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-transition-y-duration")).toBe("0.01");

    rerender(
      <CalendarFloatingDetailPanel
        detail={{
          ...detail,
          anchorElement: null,
          sourceCellElement: null,
          anchorKind: "parked",
          parked: true,
        }}
        label="Events"
        calendarPanelRef={{ current: calendarPanel }}
        railRef={{ current: rail }}
        onPark={() => {}}
        onClose={() => {}}
      >
        <div>Wash Car</div>
      </CalendarFloatingDetailPanel>,
    );

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-transition-y-type")).toBe("spring");
  });

  it("does not park agenda-anchored panels during transient row replacement", async () => {
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
    const onPark = vi.fn();

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
          parked: false,
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
        onPark={onPark}
        onClose={() => {}}
      >
        <div>Editor</div>
      </CalendarFloatingDetailPanel>,
    );

    anchorElement.remove();
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(onPark).not.toHaveBeenCalled();
  });

  it("does not park a grid-anchored detail while a connected anchor has transient outside geometry", async () => {
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
    const onPark = vi.fn();

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
          parked: false,
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
        onPark={onPark}
        onClose={() => {}}
      >
        <div>Detail</div>
      </CalendarFloatingDetailPanel>,
    );

    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(onPark).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("calendar-floating-detail-panel")).toHaveLength(1);
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
    const makeDetail = ({ forcedSide = null, sideIntent = "auto" } = {}) => ({
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
      parked: false,
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
        onPark={() => {}}
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
        onPark={() => {}}
        onClose={() => {}}
      >
        <div>Design review</div>
      </CalendarFloatingDetailPanel>,
    );

    const coldFlippedPanel = screen.getByTestId("calendar-floating-detail-panel");
    expect(coldFlippedPanel.getAttribute("data-motion-animate-opacity")).toBe("0");
    expect(coldFlippedPanel.getAttribute("data-motion-transition-x-duration")).toBe("0.01");
    expect(coldFlippedPanel.getAttribute("data-motion-transition-y-duration")).toBe("0.01");

    await act(async () => {
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
        onPark={() => {}}
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
    const makeDetail = ({ forcedSide = null, sideIntent = "auto" } = {}) => ({
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
      parked: false,
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
        onPark={() => {}}
        onClose={() => {}}
      >
        <div>Design review</div>
      </CalendarFloatingDetailPanel>,
    );

    await act(async () => {
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
        onPark={() => {}}
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
    const makeDetail = (placementKey, anchorElement) => ({
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
      parked: false,
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
        onPark={() => {}}
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
        onPark={() => {}}
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
});
