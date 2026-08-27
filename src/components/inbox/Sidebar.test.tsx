import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Sidebar from "./Sidebar";
import { SIDEBAR_COMPACT_KEY } from "./sidebarCompactStore";

const baseProps = {
  accent: "#cba6da",
  accounts: [],
  accountId: "__all",
  setAccountId: () => {},
  totalUnread: 1,
};

// Shortcut hints only render in the expanded sidebar. The sidebar owns its
// compact state (default compact-on), so seed "0" before each render.
beforeEach(() => {
  window.localStorage.setItem(SIDEBAR_COMPACT_KEY, "0");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Sidebar shortcuts", () => {
  it("labels the expanded collapse control and omits the redundant dashboard shortcut", () => {
    render(<Sidebar {...baseProps} />);

    expect(screen.getByRole("button", { name: "Collapse sidebar" }).textContent).toContain("Collapse sidebar");
    expect(screen.queryByRole("button", { name: /dashboard/i })).toBeNull();
    expect(screen.queryByText("Triage lanes")).toBeNull();
  });

  it("keeps compact account counts visible and wraps account controls in custom tooltips", () => {
    window.localStorage.setItem(SIDEBAR_COMPACT_KEY, "1");
    render(
      <Sidebar
        {...baseProps}
        accounts={[{ id: "work", name: "Work", email: "work@example.com", unread: 4, color: "#89b4fa" }]}
      />,
    );

    const accountButton = screen.getByRole("button", { name: "Work, 4" });
    expect(accountButton.closest("[data-slot='tooltip-trigger']")).toBeTruthy();
    expect(screen.getByTestId("sidebar-account-count-work").textContent).toBe("4");
    expect(screen.queryByRole("button", { name: /dashboard/i })).toBeNull();
  });

  it("shows accurate desktop inbox shortcuts without stale hold, reply, or pin hints", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedEmail={{
          id: "msg-1",
          uid: "msg-1",
          snapshot_item_id: 1,
          _activeSnapshot: true,
          _lane: "needs_attention",
        }}
      />,
    );

    expect(screen.getByText("Navigate")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Mark handled")).toBeTruthy();
    expect(screen.getByText("Dismiss")).toBeTruthy();
    expect(screen.getByText("Snooze")).toBeTruthy();
    expect(screen.getByText("Trash")).toBeTruthy();
    expect(screen.getByText("Move to FYI")).toBeTruthy();
    expect(screen.getByText("Move to Noise")).toBeTruthy();
    expect(screen.getByText("Find")).toBeTruthy();
    expect(screen.getByText("Undo")).toBeTruthy();

    expect(screen.queryByText(/hold/i)).toBeNull();
    expect(screen.queryByText("Reply")).toBeNull();
    expect(screen.queryByText("Pin")).toBeNull();
  });

  it("shows Reopen instead of lane move hints for handled snapshot rows", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedEmail={{
          id: "msg-1",
          uid: "msg-1",
          snapshot_item_id: 1,
          _activeSnapshot: true,
          _lane: "handled",
        }}
      />,
    );

    expect(screen.getByText("Reopen")).toBeTruthy();
    expect(screen.queryByText("Mark handled")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
  });

  it("shows Mark handled for FYI snapshot rows", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedEmail={{
          id: "msg-1",
          uid: "msg-1",
          snapshot_item_id: 1,
          _activeSnapshot: true,
          _lane: "fyi",
        }}
      />,
    );

    expect(screen.getByText("Mark handled")).toBeTruthy();
    expect(screen.queryByText("Move to FYI")).toBeNull();
  });

  it("keeps selected Catch-up shortcuts review-only", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedEmail={{
          id: "msg-1",
          uid: "msg-1",
          snapshot_item_id: 1,
          _activeSnapshot: true,
          _lane: "catch_up",
        }}
      />,
    );

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByText("Mark handled")).toBeNull();
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(screen.queryByText("Move to Needs")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
    expect(screen.queryByText("Snooze")).toBeNull();
    expect(screen.queryByText("Trash")).toBeNull();
  });

  it("keeps queued and untriaged-read shortcuts constrained", () => {
    const { rerender } = render(
      <Sidebar
        {...baseProps}
        selectedEmail={{
          id: "msg-1",
          uid: "msg-1",
          snapshot_item_id: 1,
          _activeSnapshot: true,
          _lane: "queued",
        }}
      />,
    );

    expect(screen.getByText("Dismiss")).toBeTruthy();
    expect(screen.queryByText("Mark handled")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.getByText("Snooze")).toBeTruthy();
    expect(screen.getByText("Trash")).toBeTruthy();

    rerender(
      <Sidebar
        {...baseProps}
        selectedEmail={{
          id: "msg-2",
          uid: "msg-2",
          snapshot_item_id: 2,
          _activeSnapshot: true,
          _lane: "untriaged_read",
        }}
      />,
    );

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(screen.queryByText("Mark handled")).toBeNull();
    expect(screen.queryByText("Snooze")).toBeNull();
    expect(screen.queryByText("Trash")).toBeNull();
  });
});
