import { describe, expect, it } from "vitest";

import { checkColorForDot, selectedEventColorId } from "./quickActionColorModel.js";

describe("quickActionColorModel.selectedEventColorId", () => {
  it("prefers an explicit colorId, coerced to a string", () => {
    expect(selectedEventColorId({ colorId: 11 })).toBe("11");
  });

  it("falls back to sourceColorId when colorId is absent", () => {
    expect(selectedEventColorId({ colorId: null, sourceColorId: 3 })).toBe("3");
  });

  it("maps a visible/source hex back to a palette id when no colorId is set", () => {
    // #4285f4 maps to colorId "9" (Blueberry) via googleEventColorIdForSourceHex.
    expect(selectedEventColorId({ colorId: null, sourceColor: "#4285F4", color: "#4285F4" })).toBe("9");
  });

  it("returns null when there is no color signal at all", () => {
    expect(selectedEventColorId({})).toBe(null);
    expect(selectedEventColorId(null)).toBe(null);
  });
});

describe("quickActionColorModel.checkColorForDot", () => {
  it("uses a dark check on light fills and a light check on dark fills", () => {
    expect(checkColorForDot("#ffffff")).toBe("#16161e");
    expect(checkColorForDot("#000000")).toBe("#f8f5ff");
    // Tomato (#dc2127) is below the 0.58 luminance threshold → light check.
    expect(checkColorForDot("#dc2127")).toBe("#f8f5ff");
  });

  it("defaults to a light check for malformed hex values", () => {
    expect(checkColorForDot("#fff")).toBe("#f8f5ff");
    expect(checkColorForDot("")).toBe("#f8f5ff");
  });
});
