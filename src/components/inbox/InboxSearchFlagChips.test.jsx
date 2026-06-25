import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toggleReadStateFlag } from "./InboxSearchFlagChipsModel.js";
import InboxSearchFlagChips from "./InboxSearchFlagChips.jsx";

afterEach(() => {
  cleanup();
});

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

describe("InboxSearchFlagChips", () => {
  it("turns read/unread flags into toggles for the search query", () => {
    const onChange = vi.fn();
    render(
      <InboxSearchFlagChips
        query="amazon"
        onChange={onChange}
        accent="#cba6da"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle unread search flag" }));

    expect(onChange).toHaveBeenCalledWith("is:unread amazon");
  });

  it("renders as a single unread chip that is off for read/default queries", () => {
    render(
      <InboxSearchFlagChips
        query="is:read amazon"
        onChange={() => {}}
        accent="#cba6da"
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button").textContent).toBe("Unread");
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  });

  it("uses the touch token only in compact (mobile) mode, preserving the 30px desktop height", () => {
    const { rerender } = render(
      <InboxSearchFlagChips query="amazon" onChange={() => {}} accent="#cba6da" />,
    );
    expect(screen.getByRole("button").style.height).toBe("30px");

    rerender(
      <InboxSearchFlagChips query="amazon" onChange={() => {}} accent="#cba6da" compact />,
    );
    expect(screen.getByRole("button").style.height).toBe("var(--sp-touch-min)");
  });
});
