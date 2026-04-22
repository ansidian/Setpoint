import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  let getBoundingClientRectMock;

  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 800;

    anchor = document.createElement("button");
    document.body.appendChild(anchor);

    getBoundingClientRectMock = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if (this === anchor) {
        return rect({ top: 580, left: 100, width: 220, height: 44 });
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
});
