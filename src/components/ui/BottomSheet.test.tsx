import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import BottomSheet from "./BottomSheet";

function SheetFocusScenario() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open app actions</button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="App actions">
        <button type="button">Sync now</button>
        <details><summary>System status</summary><p>Current</p></details>
      </BottomSheet>
    </>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("BottomSheet", () => {
  // Focus ownership is a durable modal accessibility contract. Keeping the real
  // presence hook here covers the delayed portal mount that browser spot checks
  // can miss when a sheet is tested only in its initially open state.
  it("takes focus after opening from closed, restores it on Escape, and takes it again after exit", async () => {
    render(<SheetFocusScenario />);
    const trigger = screen.getByRole("button", { name: "Open app actions" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "App actions" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(screen.queryByTestId("bottom-sheet-backdrop")).toBeNull());

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "App actions" }));
  });

  it("contains reverse Tab from the dialog root and wraps native summary focus", () => {
    render(<SheetFocusScenario />);
    fireEvent.click(screen.getByRole("button", { name: "Open app actions" }));
    const dialog = screen.getByRole("dialog");
    const summary = screen.getByText("System status");
    const closeButton = screen.getByRole("button", { name: "Close" });

    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(summary);

    fireEvent.keyDown(summary, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(summary);
  });

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
