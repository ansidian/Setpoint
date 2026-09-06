import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
