import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SIDEBAR_COMPACT_KEY, readSidebarCompact, writeSidebarCompact } from "./sidebarCompactStore";

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

describe("sidebarCompactStore", () => {
  it("exposes the canonical localStorage key", () => {
    expect(SIDEBAR_COMPACT_KEY).toBe("ea:inboxSidebarCompact");
  });
  it("defaults to compact-on when nothing is stored", () => {
    expect(readSidebarCompact()).toBe(true);
  });
  it("round-trips an explicit expanded (false) value", () => {
    writeSidebarCompact(false);
    expect(window.localStorage.getItem(SIDEBAR_COMPACT_KEY)).toBe("0");
    expect(readSidebarCompact()).toBe(false);
  });
  it("round-trips an explicit compact (true) value", () => {
    writeSidebarCompact(true);
    expect(window.localStorage.getItem(SIDEBAR_COMPACT_KEY)).toBe("1");
    expect(readSidebarCompact()).toBe(true);
  });
  it("falls back to compact-on for a garbage stored value", () => {
    window.localStorage.setItem(SIDEBAR_COMPACT_KEY, "yes");
    expect(readSidebarCompact()).toBe(true);
  });
  it("survives a toggle sequence (seed expanded, toggle to compact)", () => {
    writeSidebarCompact(false);
    expect(readSidebarCompact()).toBe(false);
    writeSidebarCompact(true);
    expect(readSidebarCompact()).toBe(true);
  });
});
