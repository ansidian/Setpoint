import { describe, expect, it } from "vitest";
import { resolveEmailSearchDateWindow } from "./email-search-date-window.ts";

const NOW = "2026-07-02T18:00:00Z";

describe("resolveEmailSearchDateWindow planned-window bounds", () => {
  // The owner's date contract is Pacific (the Alfred prompt anchors all relative dates
  // to Pacific time), so a bare date names a Pacific calendar day, not a UTC one.
  it("extends a bare-date before to the Pacific end of that day (PDT)", () => {
    const window = resolveEmailSearchDateWindow("paypal statement", { before: "2026-06-15" }, { now: NOW });
    expect(window).toEqual({
      after: null,
      before: "2026-06-16T06:59:59.999Z",
    });
  });

  it("extends a bare-date before to the Pacific end of that day (PST)", () => {
    const window = resolveEmailSearchDateWindow("paypal statement", { before: "2026-01-15" }, { now: NOW });
    expect(window).toEqual({
      after: null,
      before: "2026-01-16T07:59:59.999Z",
    });
  });

  it("passes full-timestamp before bounds through unchanged", () => {
    const window = resolveEmailSearchDateWindow("paypal statement", { before: "2026-06-15T10:00:00.000Z" }, { now: NOW });
    expect(window).toEqual({
      after: null,
      before: "2026-06-15T10:00:00.000Z",
    });
  });

  it("starts a bare-date after at the Pacific start of that day", () => {
    const window = resolveEmailSearchDateWindow("paypal statement", { after: "2026-06-01" }, { now: NOW });
    expect(window).toEqual({
      after: "2026-06-01T07:00:00.000Z",
      before: null,
    });
  });

  it("passes full-timestamp after bounds through unchanged", () => {
    const window = resolveEmailSearchDateWindow("paypal statement", { after: "2026-06-01T12:00:00.000Z" }, { now: NOW });
    expect(window).toEqual({
      after: "2026-06-01T12:00:00.000Z",
      before: null,
    });
  });
});
