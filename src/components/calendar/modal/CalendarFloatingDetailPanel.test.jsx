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
      "data-motion-animate-y": animate?.y ?? "",
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
    expect(panel.getAttribute("data-motion-transition-y-type")).toBe("spring");
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
