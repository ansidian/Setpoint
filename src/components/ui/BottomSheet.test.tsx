import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BottomSheet from "./BottomSheet";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("BottomSheet", () => {
  it("exposes dialog semantics with the title as the accessible name", () => {
    render(
      <BottomSheet open onClose={() => {}} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    expect(screen.getByRole("dialog", { name: "Snapshots" })).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on a click inside the sheet", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Snapshots">
        <button type="button">Inside</button>
      </BottomSheet>,
    );

    fireEvent.click(screen.getByText("Inside"));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByRole("dialog").previousSibling;
    if (!backdrop) throw new Error("Expected sheet backdrop");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores the prior value on unmount", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = render(
      <BottomSheet open onClose={() => {}} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    // Body overflow is the scroll-lock primitive's observable compatibility
    // contract: opening must lock the page and cleanup must restore the caller's
    // exact prior value, independent of visual layout.
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("renders the header and Close button only when title is present and hideTitle is false", () => {
    const { rerender } = render(
      <BottomSheet open onClose={() => {}} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );
    expect(screen.getByText("Snapshots")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();

    rerender(
      <BottomSheet open onClose={() => {}} title="Snapshots" hideTitle>
        <div>Content</div>
      </BottomSheet>,
    );
    expect(screen.queryByText("Snapshots")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("moves focus into the dialog on open", () => {
    render(
      <BottomSheet open onClose={() => {}} title="Snapshots">
        <button type="button">First</button>
        <button type="button">Second</button>
      </BottomSheet>,
    );

    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("traps Tab focus inside the dialog, wrapping last -> first and first (Shift+Tab) -> last", () => {
    render(
      <BottomSheet open onClose={() => {}} title="Snapshots">
        <button type="button">First</button>
        <button type="button">Second</button>
      </BottomSheet>,
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });

    expect(first).toBeTruthy();
    second.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it("restores focus to the previously focused element on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <BottomSheet open onClose={() => {}} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("pushes a history entry carrying its token on open", () => {
    render(
      <BottomSheet open onClose={() => {}} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    expect(window.history.state?.eaBottomSheet).toBeTruthy();
  });

  it("dismisses via browser back (popstate losing the sheet's token)", async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("unwinds its history entry when closed via Escape", () => {
    const backSpy = vi.spyOn(window.history, "back");
    const onClose = vi.fn();
    const { rerender } = render(
      <BottomSheet open onClose={onClose} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <BottomSheet open={false} onClose={onClose} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("dismisses only the top sheet when two are stacked", async () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(
      <>
        <BottomSheet open onClose={onCloseOuter} title="Outer">
          <div>Outer content</div>
        </BottomSheet>
        <BottomSheet open onClose={onCloseInner} title="Inner">
          <div>Inner content</div>
        </BottomSheet>
      </>,
    );

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(onCloseInner).toHaveBeenCalledTimes(1);
    });
    expect(onCloseOuter).not.toHaveBeenCalled();
  });
});
