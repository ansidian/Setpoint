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
    expect(panels[0].getAttribute("data-motion-animate-y")).toBe(placedY);
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
});
