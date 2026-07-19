import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette";

describe("CommandPalette", () => {
  afterEach(() => {
    cleanup();
  });

  it("carries the blocking calendar-hotkey suspension marker while open", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    // The calendar's hotkey handler suspends its whole keyboard surface while
    // an element with data-suspend-calendar-hotkeys="blocking" is mounted
    // anywhere — assert the same presence query the handler runs.
    expect(document.querySelector("[data-suspend-calendar-hotkeys='blocking']")).toBeTruthy();
  });

  it("offers Sync now without a generation action", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Sync now")).toBeTruthy();
    expect(screen.queryByText("Generate fresh briefing")).toBeNull();
  });

  it("labels the history affordance as snapshots", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Snapshots")).toBeTruthy();
    expect(screen.getByText("Y")).toBeTruthy();
    expect(screen.queryByText("Briefing history")).toBeNull();
  });

  it("shows the settings command-comma shortcut as key hints", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Open settings")).toBeTruthy();
    expect(screen.getByLabelText("Command comma")).toBeTruthy();
    expect(screen.getByText("⌘").tagName).toBe("KBD");
    expect(screen.getByText(",").tagName).toBe("KBD");
  });

  it("offers analytics with the A key hint", () => {
    const onAction = vi.fn();
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByText("Analytics"));

    expect(screen.getByText("A").tagName).toBe("KBD");
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "analytics",
      kind: "analytics",
    }));
  });

  it("filters the list to matching commands as you type the query", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    // Unfiltered, both a calendar and a settings command are present.
    expect(screen.getByText("Go to Calendar")).toBeTruthy();
    expect(screen.getByText("Open settings")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Jump to anything…"), {
      target: { value: "calendar" },
    });

    // Only the matching command survives; non-matches drop out.
    expect(screen.getByText("Go to Calendar")).toBeTruthy();
    expect(screen.queryByText("Open settings")).toBeNull();
    expect(screen.queryByText("Go to Inbox")).toBeNull();
  });

  it("filters case-insensitively against the command label", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Jump to anything…"), {
      target: { value: "INBOX" },
    });

    expect(screen.getByText("Go to Inbox")).toBeTruthy();
    expect(screen.queryByText("Go to Dashboard")).toBeNull();
  });

  it("runs the second item when ArrowDown then Enter is pressed in the input", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={onClose}
        onAction={onAction}
      />,
    );

    const input = screen.getByPlaceholderText("Jump to anything…");
    // Cursor starts at the first item; one ArrowDown moves it to the second.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "go-inbox",
      kind: "tab",
      payload: "inbox",
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs the first item when Enter is pressed without moving the cursor", () => {
    const onAction = vi.fn();
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={onAction}
      />,
    );

    fireEvent.keyDown(screen.getByPlaceholderText("Jump to anything…"), {
      key: "Enter",
    });

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "go-dashboard",
    }));
  });

  it("Enter after typing runs the top filtered match, not the original first item", () => {
    const onAction = vi.fn();
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={onAction}
      />,
    );

    const input = screen.getByPlaceholderText("Jump to anything…");
    fireEvent.change(input, { target: { value: "analytics" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "analytics",
      kind: "analytics",
    }));
  });

  it("shows No matches. when the query matches nothing", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Jump to anything…"), {
      target: { value: "zzzznotacommand" },
    });

    expect(screen.getByText("No matches.")).toBeTruthy();
    expect(screen.queryByText("Go to Dashboard")).toBeNull();
  });

  it("Enter is a no-op when the query matches nothing", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={onClose}
        onAction={onAction}
      />,
    );

    const input = screen.getByPlaceholderText("Jump to anything…");
    fireEvent.change(input, { target: { value: "zzzznotacommand" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={onClose}
        onAction={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("syncs the cursor on mouseEnter so Enter runs the hovered item", () => {
    const onAction = vi.fn();
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={onAction}
      />,
    );

    // Hover a command far from the default first-item cursor.
    fireEvent.mouseEnter(screen.getByText("Bills"));
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to anything…"), {
      key: "Enter",
    });

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "bills",
      kind: "scroll",
      payload: "bills",
    }));
  });

  it("input has role combobox with aria-activedescendant pointing at the first option id on open", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Jump to anything…");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-controls")).toBe("command-palette-listbox");
    expect(input.getAttribute("aria-label")).toBe("Command palette");
    // First item is go-dashboard, so aria-activedescendant should point to that
    expect(input.getAttribute("aria-activedescendant")).toBe("command-palette-option-go-dashboard");
  });

  it("list container has role listbox with id command-palette-listbox", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const listbox = document.getElementById("command-palette-listbox");
    expect(listbox).toBeTruthy();
    expect(listbox?.getAttribute("role")).toBe("listbox");
  });

  it("options have role option with id and aria-selected attribute", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const dashboardOption = document.getElementById("command-palette-option-go-dashboard");
    expect(dashboardOption).toBeTruthy();
    expect(dashboardOption?.getAttribute("role")).toBe("option");
    expect(dashboardOption?.getAttribute("aria-selected")).toBe("true");

    const inboxOption = document.getElementById("command-palette-option-go-inbox");
    expect(inboxOption).toBeTruthy();
    expect(inboxOption?.getAttribute("role")).toBe("option");
    expect(inboxOption?.getAttribute("aria-selected")).toBe("false");
  });

  it("options are not tab-focusable (tabIndex absent)", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const dashboardOption = document.getElementById("command-palette-option-go-dashboard");
    expect(dashboardOption?.getAttribute("tabIndex")).toBeNull();

    const inboxOption = document.getElementById("command-palette-option-go-inbox");
    expect(inboxOption?.getAttribute("tabIndex")).toBeNull();
  });

  it("ArrowDown moves aria-activedescendant to the second option and updates aria-selected", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Jump to anything…");
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toBe("command-palette-option-go-inbox");

    const dashboardOption = document.getElementById("command-palette-option-go-dashboard");
    const inboxOption = document.getElementById("command-palette-option-go-inbox");
    expect(dashboardOption?.getAttribute("aria-selected")).toBe("false");
    expect(inboxOption?.getAttribute("aria-selected")).toBe("true");
  });

  it("filtering keeps aria-activedescendant pointing to a valid option id", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Jump to anything…");
    // Move to third item
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // Filter to only "calendar" commands
    fireEvent.change(input, { target: { value: "calendar" } });

    // After filtering, cursor should clamp to the first (and only) match
    // aria-activedescendant should point to a valid option
    const activedescendant = input.getAttribute("aria-activedescendant");
    expect(activedescendant).toBeTruthy();
    expect(document.getElementById(activedescendant!)).toBeTruthy();

    // The only calendar match should be "Go to Calendar"
    expect(screen.getByText("Go to Calendar")).toBeTruthy();
    expect(activedescendant).toBe("command-palette-option-calendar");
  });

  it("empty state div has role status for screen reader announcement", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Jump to anything…");
    fireEvent.change(input, { target: { value: "zzzznotacommand" } });

    // Find all divs in the listbox and check for the one with role="status"
    const listbox = document.getElementById("command-palette-listbox");
    const emptyDiv = listbox?.querySelector("[role='status']");
    expect(emptyDiv).toBeTruthy();
    expect(emptyDiv?.textContent).toBe("No matches.");
  });
});
