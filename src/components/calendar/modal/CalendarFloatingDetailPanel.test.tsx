import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarFloatingDetailPanel from "./CalendarFloatingDetailPanel";
import { resolveFloatingDetailPlacement } from "./calendarFloatingDetailPlacement";
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

  it("keeps the panel hidden until its first measured placement", () => {
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

    act(() => {
      resizeCallback([{ contentRect: { height: 220, width: 380 } }]);
    });

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-motion-animate-opacity")).toBe("1");
  });

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
