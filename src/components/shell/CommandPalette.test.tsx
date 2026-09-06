import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CommandPalette from "./CommandPalette";

const noop = () => {};

describe("CommandPalette", () => {
  afterEach(cleanup);

  it("keeps keyboard focus in the combobox while moving the active option", () => {
    render(<CommandPalette open accent="#cba6da" onClose={noop} onAction={noop} />);
    const input = screen.getByRole("combobox");
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toBe("command-palette-option-go-inbox");
    expect(screen.getByRole("option", { name: /Go to Inbox/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(input);
  });
});
