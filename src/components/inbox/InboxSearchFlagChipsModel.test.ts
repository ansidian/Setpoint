import { describe, expect, it } from "vitest";
import { toggleReadStateFlag } from "./InboxSearchFlagChipsModel";

describe("toggleReadStateFlag", () => {
  it("adds unread before existing text when no read-state flag exists", () => {
    expect(toggleReadStateFlag("amazon")).toBe("is:unread amazon");
  });

  it("removes unread when toggled off", () => {
    expect(toggleReadStateFlag("is:unread amazon")).toBe("amazon");
  });

  it("replaces read with unread", () => {
    expect(toggleReadStateFlag("is:read amazon")).toBe("is:unread amazon");
  });

  it("restores an empty query when unread is the only token", () => {
    expect(toggleReadStateFlag("is:unread")).toBe("");
  });
});
