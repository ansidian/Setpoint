import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { toggleReadStateFlag } from "./InboxSearchFlagChipsModel";
import InboxSearchFlagChips from "./InboxSearchFlagChips";

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
    function Harness() {
      const [query, setQuery] = useState("amazon");
      return <><output aria-label="Search query">{query}</output><InboxSearchFlagChips query={query} onChange={setQuery} accent="#cba6da" /></>;
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle unread search flag" }));

    expect(screen.getByLabelText("Search query").textContent).toBe("is:unread amazon");
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

});
