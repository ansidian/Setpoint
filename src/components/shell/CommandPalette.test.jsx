import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette.jsx";

describe("CommandPalette", () => {
  afterEach(() => {
    cleanup();
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

  it("uses the preblurred backdrop snapshot instead of a live backdrop filter", () => {
    render(
      <CommandPalette
        open
        accent="#cba6da"
        backdropSnapshot={{ dataUrl: "data:image/jpeg;base64,palette-backdrop" }}
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const overlay = screen.getByPlaceholderText("Jump to anything…").closest("[style*='position: fixed']");

    expect(overlay?.style.backdropFilter).toBe("none");
    expect(overlay?.style.backgroundImage).toContain("palette-backdrop");
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
    expect(screen.getByText("Open calendar")).toBeTruthy();
    expect(screen.getByText("Open settings")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Jump to anything…"), {
      target: { value: "calendar" },
    });

    // Only the matching command survives; non-matches drop out.
    expect(screen.getByText("Open calendar")).toBeTruthy();
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
});
