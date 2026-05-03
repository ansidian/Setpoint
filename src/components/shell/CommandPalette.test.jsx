import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette.jsx";

describe("CommandPalette", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers Sync now without a fresh briefing generation action", () => {
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
});
