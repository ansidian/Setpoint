import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CommandPalette from "./CommandPalette";
import type { CommandPaletteItem } from "./CommandPalette";

const noop = () => {};

function PaletteHarness() {
  const [open, setOpen] = useState(true);
  const [action, setAction] = useState<CommandPaletteItem | null>(null);
  return (
    <>
      <CommandPalette open={open} accent="#cba6da" onClose={() => setOpen(false)} onAction={setAction} />
      <output data-testid="palette-state">{open ? "open" : "closed"}</output>
      {action ? <output data-testid="palette-action">{[action.id, action.kind, action.payload].filter(Boolean).join("|")}</output> : null}
    </>
  );
}

describe("CommandPalette", () => {
  afterEach(cleanup);

  it("blocks calendar hotkeys while open", () => {
    render(<CommandPalette open accent="#cba6da" onClose={noop} onAction={noop} />);

    expect(document.querySelector("[data-suspend-calendar-hotkeys='blocking']")).toBeTruthy();
  });

  it.each([
    ["Go to Events", "events|calendar-view|events"],
    ["Go to Bills", "bills|calendar-view|bills"],
  ])("routes %s to its calendar destination", (label, expectedAction) => {
    render(<PaletteHarness />);

    fireEvent.click(screen.getByText(label));

    expect(screen.getByTestId("palette-action").textContent).toBe(expectedAction);
  });

  it.each([
    ["1", "go-dashboard|tab|dashboard"],
    ["9", "settings|settings"],
  ])("runs numbered result %s and closes", (key, expectedAction) => {
    render(<PaletteHarness />);

    fireEvent.keyDown(screen.getByRole("combobox"), { key });

    expect(screen.getByTestId("palette-action").textContent).toBe(expectedAction);
    expect(screen.getByTestId("palette-state").textContent).toBe("closed");
  });

  it("renumbers filtered results before applying number shortcuts", () => {
    render(<PaletteHarness />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "settings" } });

    const option = screen.getByRole("option");
    expect(option.querySelector("kbd")?.textContent).toBe("1");
    expect(option.getAttribute("aria-keyshortcuts")).toBe("1");

    fireEvent.keyDown(input, { key: "1" });
    expect(screen.getByTestId("palette-action").textContent).toBe("settings|settings");
  });

  it("does not run number shortcuts with modifiers", () => {
    render(<PaletteHarness />);

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "1", metaKey: true });
    fireEvent.keyDown(input, { key: "1", ctrlKey: true });
    fireEvent.keyDown(input, { key: "1", altKey: true });

    expect(screen.queryByTestId("palette-action")).toBeNull();
    expect(screen.getByTestId("palette-state").textContent).toBe("open");
  });

  it("keeps the palette open when a number has no matching result", () => {
    render(<PaletteHarness />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "events" } });
    fireEvent.keyDown(input, { key: "2" });

    expect(screen.queryByTestId("palette-action")).toBeNull();
    expect(screen.getByTestId("palette-state").textContent).toBe("open");
  });

  it("filters case-insensitively and Enter runs the top match", () => {
    render(<PaletteHarness />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ANALYTICS" } });

    expect(screen.getByRole("option").textContent).toContain("Analytics");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("palette-action").textContent).toBe("analytics|analytics");
  });

  it("finds commands through hidden aliases", () => {
    render(<PaletteHarness />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "email" } });

    expect(screen.getByRole("option").textContent).toContain("Go to Inbox");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("palette-action").textContent).toBe("go-inbox|tab|inbox");
  });

  it("preserves command order when an alias matches multiple results", () => {
    render(<PaletteHarness />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "briefing" } });

    expect(screen.getAllByRole("option").map((option) => option.querySelector("span")?.textContent)).toEqual([
      "Go to Dashboard",
      "Snapshots",
    ]);
  });

  it("ArrowDown updates the active option and Enter runs it", () => {
    render(<PaletteHarness />);

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toBe("command-palette-option-go-inbox");
    expect(document.getElementById("command-palette-option-go-inbox")?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("palette-action").textContent).toBe("go-inbox|tab|inbox");
  });

  it("announces an empty result set and Enter does nothing", () => {
    render(<PaletteHarness />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzznotacommand" } });

    expect(screen.getByText("No matches.").getAttribute("role")).toBe("status");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByTestId("palette-action")).toBeNull();
    expect(screen.getByTestId("palette-state").textContent).toBe("open");
  });

  it("closes when Escape is pressed", () => {
    render(<PaletteHarness />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByTestId("palette-state").textContent).toBe("closed");
  });
});
