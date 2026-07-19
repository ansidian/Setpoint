import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusChip } from "./StatusChip";

afterEach(cleanup);

describe("StatusChip", () => {
  it("renders its status label", () => {
    render(<StatusChip label="Due today" tone="#f38ba8" />);
    expect(screen.getByText("Due today")).toBeTruthy();
  });

  it("renders an optional glyph before the label", () => {
    render(<StatusChip label="Demo Electric" tone="#89b4fa" glyph={<svg data-testid="chip-glyph" />} />);
    const chip = screen.getByText("Demo Electric").parentElement;
    const glyph = screen.getByTestId("chip-glyph");
    expect(chip?.contains(glyph)).toBe(true);
    expect(chip?.firstChild).toBe(glyph);
  });
});
