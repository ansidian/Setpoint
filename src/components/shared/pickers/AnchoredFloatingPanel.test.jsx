import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnchoredFloatingPanel from "./AnchoredFloatingPanel.jsx";

function rect({ top, left, width, height }) {
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
  let anchor;
  let alternateAnchor;
  let getBoundingClientRectMock;

  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 800;

    anchor = document.createElement("button");
    alternateAnchor = document.createElement("button");
    document.body.appendChild(anchor);
    document.body.appendChild(alternateAnchor);

    getBoundingClientRectMock = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
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

    await waitFor(() => {
      expect(panel.style.top).toBe("162px");
      expect(panel.style.left).toBe("820px");
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

    expect(panel.style.overflow).not.toBe("hidden");
    expect(panel.style.overflowY).toBe("auto");
    expect(panel.style.overscrollBehavior).toBe("contain");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
        onClose={onClose}
      >
        <div style={{ height: 200 }}>Content</div>
      </AnchoredFloatingPanel>,
    );

    await screen.findByRole("dialog", { name: "Test anchored panel" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on an outside pointerdown but spares the panel, anchor, and sibling calendar popovers", async () => {
    const onClose = vi.fn();
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Test anchored panel"
        onClose={onClose}
      >
        <button type="button">Inside</button>
      </AnchoredFloatingPanel>,
    );

    const panel = await screen.findByRole("dialog", { name: "Test anchored panel" });

    fireEvent.pointerDown(panel);
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();

    const sibling = document.createElement("div");
    sibling.setAttribute("data-calendar-popover-panel", "true");
    const inner = document.createElement("button");
    sibling.appendChild(inner);
    document.body.appendChild(sibling);
    fireEvent.pointerDown(inner);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    sibling.remove();
  });
});
