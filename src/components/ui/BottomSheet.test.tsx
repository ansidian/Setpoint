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
    let closeCount = 0;
    render(
      <BottomSheet open onClose={() => { closeCount += 1; }} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeCount).toBe(1);
  });

  it("closes on backdrop click but not on a click inside the sheet", () => {
    let closeCount = 0;
    render(
      <BottomSheet open onClose={() => { closeCount += 1; }} title="Snapshots">
        <button type="button">Inside</button>
      </BottomSheet>,
    );

    fireEvent.click(screen.getByText("Inside"));
    expect(closeCount).toBe(0);

    fireEvent.click(screen.getByTestId("bottom-sheet-backdrop"));
    expect(closeCount).toBe(1);
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
    let closeCount = 0;
    render(
      <BottomSheet open onClose={() => { closeCount += 1; }} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(closeCount).toBe(1);
    });
  });

  it("unwinds its history entry when closed via Escape", async () => {
    let closeCount = 0;
    const { rerender } = render(
      <BottomSheet open onClose={() => { closeCount += 1; }} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeCount).toBe(1);

    rerender(
      <BottomSheet open={false} onClose={() => { closeCount += 1; }} title="Snapshots">
        <div>Content</div>
      </BottomSheet>,
    );

    await waitFor(() => expect(window.history.state?.eaBottomSheet).toBeUndefined());
  });

  it("dismisses only the top sheet when two are stacked", async () => {
    let outerCloseCount = 0;
    let innerCloseCount = 0;
    render(
      <>
        <BottomSheet open onClose={() => { outerCloseCount += 1; }} title="Outer">
          <div>Outer content</div>
        </BottomSheet>
        <BottomSheet open onClose={() => { innerCloseCount += 1; }} title="Inner">
          <div>Inner content</div>
        </BottomSheet>
      </>,
    );

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(innerCloseCount).toBe(1);
    });
    expect(outerCloseCount).toBe(0);
  });
});
