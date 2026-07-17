import { describe, expect, it } from "vitest";
import { clampMenuPosition, menuStyle } from "./quickActionMenuLayout";

describe("clampMenuPosition", () => {
  it("passes the anchor through when it fits, floored by padding", () => {
    window.innerWidth = 1600;
    window.innerHeight = 900;
    expect(clampMenuPosition({ x: 140, y: 180, bottomReserve: 232 })).toEqual({
      left: 140,
      top: 180,
      width: 220,
    });
  });

  it("clamps to the right and bottom edges using width and bottomReserve", () => {
    window.innerWidth = 300;
    window.innerHeight = 400;
    // right floor: 300 - 220 - 12 = 68 ; bottom floor: 400 - 232 = 168
    expect(clampMenuPosition({ x: 9999, y: 9999, bottomReserve: 232 })).toEqual({
      left: 68,
      top: 168,
      width: 220,
    });
  });

  it("floors at the padding for small/negative coordinates", () => {
    window.innerWidth = 1600;
    window.innerHeight = 900;
    expect(clampMenuPosition({ x: 0, y: -50, bottomReserve: 232 })).toEqual({
      left: 12,
      top: 12,
      width: 220,
    });
  });

  it("bottomReserve drives only the bottom clamp (deadline 170 vs calendar 232)", () => {
    window.innerWidth = 1600;
    window.innerHeight = 200;
    // y overflows: deadline reserves 170 -> 200-170=30 ; calendar reserves 232 -> floored to padding 12
    expect(clampMenuPosition({ x: 100, y: 9999, bottomReserve: 170 }).top).toBe(30);
    expect(clampMenuPosition({ x: 100, y: 9999, bottomReserve: 232 }).top).toBe(12);
  });

  it("respects a custom width in the right-edge clamp", () => {
    window.innerWidth = 300;
    window.innerHeight = 900;
    // right floor: 300 - 184 - 12 = 104
    expect(clampMenuPosition({ x: 9999, y: 100, width: 184, bottomReserve: 232 })).toEqual({
      left: 104,
      top: 100,
      width: 184,
    });
  });
});

describe("menuStyle", () => {
  it("clamps a 220px menu reserving height+padding (232) below the anchor", () => {
    window.innerWidth = 300;
    window.innerHeight = 400;
    expect(menuStyle({ x: 9999, y: 9999 })).toEqual({ left: 68, top: 168, width: 220 });
  });

  it("passes the anchor through when it fits", () => {
    window.innerWidth = 1600;
    window.innerHeight = 900;
    expect(menuStyle({ x: 140, y: 180 })).toEqual({ left: 140, top: 180, width: 220 });
  });
});
