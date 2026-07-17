import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnchoredFloatingPanel from "./AnchoredFloatingPanel";
import type BottomSheet from "@/components/ui/BottomSheet";
import type { BottomSheetProps } from "@/components/ui/BottomSheet";
import useIsMobile from "@/hooks/useIsMobile";

vi.mock("@/hooks/useIsMobile", () => ({ default: vi.fn(() => false) }));

// jsdom/happy-dom's CSS grammar doesn't recognize the `min()` math function, so
// setting element.style.height to it silently no-ops (verified against both
// engines) — a test-environment gap, not a real-browser one. Wrap (not
// replace) BottomSheet so every other test here still exercises the real
// primitive, while the height-forwarding test below can inspect the actual
// prop value instead of reading it back off a DOM CSSOM that can't represent it.
const { recordedBottomSheetProps } = vi.hoisted((): { recordedBottomSheetProps: BottomSheetProps[] } => ({ recordedBottomSheetProps: [] }));
vi.mock("@/components/ui/BottomSheet", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof BottomSheet }>();
  return {
    default: (props: BottomSheetProps) => {
      recordedBottomSheetProps.push(props);
      return actual.default(props);
    },
  };
});

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
    vi.mocked(useIsMobile).mockReturnValue(false);
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
    if (!anchor) throw new Error("Expected anchor fixture");
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

  it("renders content through BottomSheet on mobile (sheet, not anchored)", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Snooze options"
        onClose={() => {}}
      >
        <button type="button">Tomorrow</button>
      </AnchoredFloatingPanel>,
    );

    // BottomSheet renders the ariaLabel as a header title + a Close button; the
    // anchored panel's marker is absent because AnchoredPanelDesktop never mounts.
    expect(screen.getByText("Snooze options")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(document.querySelector('[data-calendar-popover-panel="true"]')).toBeNull();
  });

  it("hideTitle drops the sheet header entirely (no visible title, no redundant Close) but keeps the accessible name and dismissal", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const onClose = vi.fn();
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        role="dialog"
        ariaLabel="Deadline"
        hideTitle
        onClose={onClose}
      >
        <div>Glance content</div>
      </AnchoredFloatingPanel>,
    );

    // The card carries its own eyebrow, so the header collapses to nothing: no
    // visible title and no Close button — the bottom sheet is dismissed by
    // drag-down, backdrop tap, or Escape, so the X is dead chrome over empty space.
    expect(screen.queryByText("Deadline")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    // The dialog still exposes its accessible name (aria-label) and content.
    expect(screen.getByRole("dialog", { name: "Deadline" })).toBeTruthy();
    expect(screen.getByText("Glance content")).toBeTruthy();
    // Removing the X did not strand the sheet: Escape still dismisses it.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("forwards a numeric height to the mobile sheet, clamped so a tall desktop hint can't force a full-screen sheet (UX-L10)", () => {
    recordedBottomSheetProps.length = 0;
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        role="dialog"
        ariaLabel="Snooze options"
        height={400}
        onClose={() => {}}
      >
        <div>Content</div>
      </AnchoredFloatingPanel>,
    );

    expect(recordedBottomSheetProps[recordedBottomSheetProps.length - 1]?.height).toBe("min(400px, 70vh)");
  });

  it("does not crash and leaks no style when a desktop-only style/width prop reaches the mobile sheet (UX-L10)", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        role="dialog"
        ariaLabel="Snooze options"
        width={300}
        style={{ padding: 999 }}
        onClose={() => {}}
      >
        <div>Content</div>
      </AnchoredFloatingPanel>,
    );

    const dialog = screen.getByRole("dialog", { name: "Snooze options" });
    expect(dialog.style.padding).toBe("");
  });

  it("stays anchored on mobile when disableMobileSheet is set", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(
      <AnchoredFloatingPanel
        anchorRef={{ current: anchor }}
        width={300}
        height={386}
        role="dialog"
        ariaLabel="Snooze options"
        disableMobileSheet
        onClose={() => {}}
      >
        <button type="button">Tomorrow</button>
      </AnchoredFloatingPanel>,
    );

    // Opt-out: anchored path is taken even on mobile — the dialog renders and
    // there is no BottomSheet (no Close button).
    await screen.findByRole("dialog", { name: "Snooze options" });
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
