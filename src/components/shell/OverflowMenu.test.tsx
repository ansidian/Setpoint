import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverflowMenu } from "./OverflowMenu";
import type { OverflowMenuProps } from "./OverflowMenu";

function Harness(overrides: Partial<OverflowMenuProps> = {}) {
  const onToggleMenu = overrides.onToggleMenu ?? vi.fn();
  const onCloseMenu = overrides.onCloseMenu ?? vi.fn();
  const onOpenHistory = overrides.onOpenHistory ?? vi.fn();
  const onOpenAnalytics = overrides.onOpenAnalytics ?? vi.fn();

  return {
    onToggleMenu,
    onCloseMenu,
    onOpenHistory,
    onOpenAnalytics,
    ...render(
      <MemoryRouter>
        <OverflowMenu
          isMobile={overrides.isMobile ?? false}
          menuOpen={overrides.menuOpen ?? false}
          onToggleMenu={onToggleMenu}
          onCloseMenu={onCloseMenu}
          onOpenHistory={onOpenHistory}
          onOpenAnalytics={onOpenAnalytics}
        />
      </MemoryRouter>,
    ),
  };
}

describe("OverflowMenu menu-button semantics + keyboard model", () => {
  afterEach(cleanup);

  it("exposes aria-haspopup=menu on the trigger and flips aria-expanded with menuOpen", () => {
    const { rerender } = render(
      <MemoryRouter>
        <OverflowMenu
          isMobile={false}
          menuOpen={false}
          onToggleMenu={vi.fn()}
          onCloseMenu={vi.fn()}
          onOpenHistory={vi.fn()}
          onOpenAnalytics={vi.fn()}
        />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: /open more actions/i });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    rerender(
      <MemoryRouter>
        <OverflowMenu
          isMobile={false}
          menuOpen
          onToggleMenu={vi.fn()}
          onCloseMenu={vi.fn()}
          onOpenHistory={vi.fn()}
          onOpenAnalytics={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /open more actions/i }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("renders the popup as role=menu with role=menuitem items, labelled for AT", () => {
    Harness({ menuOpen: true });

    const menu = screen.getByRole("menu", { name: /more actions/i });
    expect(menu).toBeTruthy();

    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const item of items) {
      expect(item.tabIndex).toBe(-1);
    }
  });

  it("moves focus to the first menuitem when the menu opens", () => {
    Harness({ menuOpen: true });

    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
  });

  it("ArrowDown moves focus to the next menuitem and wraps past the last", () => {
    Harness({ menuOpen: true });

    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    // wrap from last back to first
    fireEvent.keyDown(items[items.length - 1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("ArrowUp moves focus to the previous menuitem and wraps past the first", () => {
    Harness({ menuOpen: true });

    const items = screen.getAllByRole("menuitem");

    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(items[items.length - 1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 2]);
  });

  it("Home and End jump focus to the first and last menuitem", () => {
    Harness({ menuOpen: true });

    const items = screen.getAllByRole("menuitem");

    fireEvent.keyDown(items[0]!, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(items[items.length - 1]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("Escape closes the menu and returns focus to the trigger", () => {
    const onCloseMenu = vi.fn();
    Harness({ menuOpen: true, onCloseMenu });

    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(items[0]!, { key: "Escape" });

    expect(onCloseMenu).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /open more actions/i }));
  });

  it("Tab closes the menu", () => {
    const onCloseMenu = vi.fn();
    Harness({ menuOpen: true, onCloseMenu });

    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(items[0]!, { key: "Tab" });

    expect(onCloseMenu).toHaveBeenCalledTimes(1);
  });

  it("does not reset focus when the parent re-renders with a new (non-memoized) onCloseMenu while the menu stays open", () => {
    // Regression test: an inline arrow function passed as onCloseMenu changes
    // identity on every parent render. The initial-focus effect must key only
    // off menuOpen, not onCloseMenu, or an unrelated re-render mid-navigation
    // would yank focus back to the first item.
    function ParentWithUnrelatedState() {
      const [bump, setBump] = useState(0);
      return (
        <MemoryRouter>
          <div>
            <button type="button" onClick={() => setBump((value) => value + 1)}>
              Bump {bump}
            </button>
            <OverflowMenu
              isMobile={false}
              menuOpen
              onToggleMenu={vi.fn()}
              // Inline, non-memoized: a fresh function identity every render.
              onCloseMenu={() => {}}
              onOpenHistory={vi.fn()}
              onOpenAnalytics={vi.fn()}
            />
          </div>
        </MemoryRouter>
      );
    }

    render(<ParentWithUnrelatedState />);

    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    // Force an unrelated parent re-render (new onCloseMenu identity, menu stays open).
    fireEvent.click(screen.getByRole("button", { name: /bump/i }));

    expect(document.activeElement).toBe(items[1]);
  });

  it("activating Snapshots still calls onCloseMenu and onOpenHistory", () => {
    const onCloseMenu = vi.fn();
    const onOpenHistory = vi.fn();
    Harness({ menuOpen: true, onCloseMenu, onOpenHistory });

    const snapshotsItem = screen.getByRole("menuitem", { name: /snapshots/i });
    fireEvent.click(snapshotsItem);

    expect(onCloseMenu).toHaveBeenCalledTimes(1);
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });
});
