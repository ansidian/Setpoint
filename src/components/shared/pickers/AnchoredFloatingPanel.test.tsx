import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnchoredFloatingPanel from "./AnchoredFloatingPanel";
import { resolveMobileSheetHeight } from "./anchoredFloatingPanelModel";

function rect({ top, left, width, height }: Pick<DOMRect, "top" | "left" | "width" | "height">): DOMRect {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  };
}

describe("AnchoredFloatingPanel", () => {
  let anchor: HTMLButtonElement | null;
  let alternateAnchor: HTMLButtonElement | null;
  let getBoundingClientRectMock: { mockRestore(): void } | null;

  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 800;

    anchor = document.createElement("button");
    alternateAnchor = document.createElement("button");
    document.body.appendChild(anchor);
    document.body.appendChild(alternateAnchor);

    getBoundingClientRectMock = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect(this: HTMLElement) {
      if (this === anchor) {
        return rect({ top: 580, left: 100, width: 220, height: 44 });
      }
      if (this === alternateAnchor) {
        return rect({ top: 120, left: 820, width: 180, height: 36 });
      }
      if (this.getAttribute?.("aria-label") === "Test anchored panel") {
        return rect({ top: 0, left: 0, width: 300, height: 200 });
      }
      return rect({ top: 0, left: 0, width: 0, height: 0 });
    });
  });

  afterEach(() => {
    cleanup();
    getBoundingClientRectMock?.mockRestore();
    anchor?.remove();
    alternateAnchor?.remove();
  });

  it("does not render a top-left panel before an anchor exists", () => {
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: null }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
      >
        <div>Content</div>
      </AnchoredFloatingPanel>,
    );

    expect(screen.queryByRole("dialog", { name: "Test anchored panel" })).toBeNull();
  });

  it("repositions using the rendered panel height instead of the configured max height", async () => {
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
      >
        <div style={{ height: 200 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    const panel = await screen.findByRole("dialog", { name: "Test anchored panel" });

    // Fixed coordinates are the output of the anchored-placement contract for
    // the mocked rectangles; a wrong value strands the panel off its trigger.
    await waitFor(() => {
      expect(panel.style.top).toBe("374px");
      expect(panel.style.left).toBe("100px");
    });
  });

  it("retargets to a changed anchor without preserving stale placement", async () => {
    const { rerender } = render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
      >
        <div style={{ height: 200 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    const panel = await screen.findByRole("dialog", { name: "Test anchored panel" });
    // The first coordinate establishes the old anchor before the rerender.
    await waitFor(() => {
      expect(panel.style.left).toBe("100px");
    });

    rerender(
      <AnchoredFloatingPanel
        anchorRef={{ current: alternateAnchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
      >
        <div style={{ height: 200 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    // These coordinates prove the public re-anchoring behavior, not browser layout.
    await waitFor(() => {
      expect(panel.style.top).toBe("162px");
      expect(panel.style.left).toBe("820px");
    });
  });

  it("supports a draggable animated placement that resets to a new anchor", async () => {
    const { rerender } = render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
        animatePosition
        draggable
        dragHandleLabel="Deadline"
        placementKey="deadline:one"
      >
        <div style={{ height: 200 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    const panel = await screen.findByRole("dialog", { name: "Test anchored panel" });
    const handle = screen.getByTestId("anchored-floating-panel-drag-handle");
    await waitFor(() => expect(panel.getAttribute("data-floating-left")).toBe("100"));

    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 110, clientY: 384 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 310, clientY: 260 });
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 310, clientY: 260 });

    await waitFor(() => expect(panel.getAttribute("data-floating-position-source")).toBe("drag"));

    rerender(
      <AnchoredFloatingPanel
        anchorRef={{ current: alternateAnchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
        animatePosition
        draggable
        dragHandleLabel="Event"
        placementKey="event:two"
      >
        <div style={{ height: 200 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    await waitFor(() => {
      expect(panel.getAttribute("data-floating-position-source")).toBe("anchor");
      expect(panel.getAttribute("data-floating-left")).toBe("820");
      expect(panel.getAttribute("data-floating-top")).toBe("162");
    });
  });

  it("keeps scroll containment active even when callers pass overflow styles", async () => {
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
        style={{ overflow: "hidden", padding: 8 }}
      >
        <div style={{ height: 900 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    const panel = await screen.findByRole("dialog", { name: "Test anchored panel" });

    // Scroll containment is an explicit floating-panel compatibility contract:
    // caller overflow styles must not re-enable page scroll chaining.
    expect(panel.style.overflow).not.toBe("hidden");
    expect(panel.style.overflowY).toBe("auto");
    expect(panel.style.overscrollBehavior).toBe("contain");
  });

  it("closes on Escape", async () => {
    let closeCount = 0;
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
        onClose={() => { closeCount += 1; }}
      >
        <div style={{ height: 200 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    await screen.findByRole("dialog", { name: "Test anchored panel" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeCount).toBe(1);
  });

  it("dismisses on an outside pointerdown but spares the panel, anchor, and sibling calendar popovers", async () => {
    let closeCount = 0;
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
        onClose={() => { closeCount += 1; }}
      >
        <button type="button">Inside</button>
      </AnchoredFloatingPanel>,
    );

    const panel = await screen.findByRole("dialog", { name: "Test anchored panel" });

    fireEvent.pointerDown(panel);
    if (!anchor) throw new Error("Expected anchor fixture");
    fireEvent.pointerDown(anchor);
    expect(closeCount).toBe(0);

    const sibling = document.createElement("div");
    sibling.setAttribute("data-calendar-popover-panel", "true");
    const inner = document.createElement("button");
    sibling.appendChild(inner);
    document.body.appendChild(sibling);
    fireEvent.pointerDown(inner);
    expect(closeCount).toBe(0);

    fireEvent.pointerDown(document.body);
    expect(closeCount).toBe(1);

    sibling.remove();
  });

  it("clamps numeric desktop height hints for the mobile sheet (UX-L10)", () => {
    expect(resolveMobileSheetHeight(400, undefined)).toBe("min(400px, 70vh)");
    expect(resolveMobileSheetHeight(400, null)).toBeUndefined();
    expect(resolveMobileSheetHeight(400, "50vh")).toBe("50vh");
  });

});
