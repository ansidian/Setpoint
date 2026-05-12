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
});
