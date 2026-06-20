import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusChip } from "./StatusChip.jsx";

afterEach(cleanup);

describe("StatusChip", () => {
  it("color-mixes the tone for the fill and uses the tone for the text color", () => {
    render(<StatusChip label="Due today" tone="#f38ba8" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.textContent).toBe("Due today");
    // happy-dom cannot parse color-mix(): it is dropped from BOTH the parsed CSSOM
    // (style.background === "") and the serialized style attribute, so the fill is
    // not unit-assertable here — it is covered by the Phase-1 browser smoke instead.
    // happy-dom also returns hex verbatim without normalizing color to rgb().
    expect(chip.style.color).toBe("#f38ba8");
    expect(chip.style.borderRadius).toBe("99px");
    expect(chip.style.whiteSpace).toBe("nowrap");
    expect(chip.style.fontVariantNumeric).toBe("tabular-nums");
  });

  it("passes a CSS-var tone straight through without breaking", () => {
    render(<StatusChip label="Up next" tone="var(--sp-accent)" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.style.color).toBe("var(--sp-accent)");
    // (background color-mix is dropped by happy-dom — see the note in the first test)
  });

  it("uses 10px by default and 9.5px when compact", () => {
    const { rerender } = render(<StatusChip label="In 2d" tone="#89b4fa" />);
    expect(screen.getByTestId("status-chip").style.fontSize).toBe("10px");
    rerender(<StatusChip label="In 2d" tone="#89b4fa" compact />);
    expect(screen.getByTestId("status-chip").style.fontSize).toBe("9.5px");
  });

  it("renders an optional glyph before the label", () => {
    render(<StatusChip label="Demo Electric" tone="#89b4fa" glyph={<svg data-testid="chip-glyph" />} />);
    const chip = screen.getByTestId("status-chip");
    const glyph = screen.getByTestId("chip-glyph");
    expect(chip.contains(glyph)).toBe(true);
    expect(chip.firstChild).toBe(glyph);
  });
});
