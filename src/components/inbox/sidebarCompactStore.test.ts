import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SIDEBAR_COMPACT_KEY, readSidebarCompact, writeSidebarCompact } from "./sidebarCompactStore";

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

describe("sidebarCompactStore", () => {
  it("defaults to compact-on when nothing is stored", () => {
    expect(readSidebarCompact()).toBe(true);
  });
  it("round-trips an explicit expanded (false) value", () => {
    writeSidebarCompact(false);
    expect(window.localStorage.getItem(SIDEBAR_COMPACT_KEY)).toBe("0");
    expect(readSidebarCompact()).toBe(false);
  });
  it("falls back to compact-on for a garbage stored value", () => {
    window.localStorage.setItem(SIDEBAR_COMPACT_KEY, "yes");
    expect(readSidebarCompact()).toBe(true);
  });
});
