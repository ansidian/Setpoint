import { describe, expect, it } from "vitest";
import { MOBILE_MAX_WIDTH, MOBILE_MEDIA_QUERY } from "./breakpoints.js";

describe("breakpoints", () => {
  it("exposes the inclusive mobile max width", () => {
    expect(MOBILE_MAX_WIDTH).toBe(639);
  });

  it("builds the byte-identical mobile media query (no off-by-one)", () => {
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 639px)");
  });
});
