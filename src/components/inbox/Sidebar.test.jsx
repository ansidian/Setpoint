import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Sidebar from "./Sidebar.jsx";

const baseProps = {
  accent: "#cba6da",
  accounts: [],
  accountId: "__all",
  setAccountId: () => {},
  lane: "__all",
  setLane: () => {},
  laneCounts: {
    carryover: 0,
    needs_attention: 1,
    catch_up: 0,
    fyi: 0,
    handled: 0,
    noise: 0,
  },
  totalUnread: 1,
  compact: false,
  onOpenDashboard: () => {},
};

afterEach(() => {
  cleanup();
});

describe("Sidebar shortcuts", () => {
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

  it("shows a muted unread hint on the Noise lane row", () => {
    render(
      <Sidebar
        {...baseProps}
        laneCounts={{ ...baseProps.laneCounts, noise: 8 }}
        noiseUnreadCount={3}
      />,
    );

    expect(screen.getByText("Noise")).toBeTruthy();
    expect(screen.getByText("3 unread")).toBeTruthy();
  });

  it("includes Catch-up in lane navigation but keeps selected Catch-up shortcuts review-only", () => {
    render(
      <Sidebar
        {...baseProps}
        laneCounts={{ ...baseProps.laneCounts, catch_up: 2 }}
        selectedEmail={{
          id: "msg-1",
          uid: "msg-1",
          snapshot_item_id: 1,
          _activeSnapshot: true,
          _lane: "catch_up",
        }}
      />,
    );

    expect(screen.getByText("Catch-up")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByText("Mark handled")).toBeNull();
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(screen.queryByText("Move to Needs")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
    expect(screen.queryByText("Snooze")).toBeNull();
    expect(screen.queryByText("Trash")).toBeNull();
  });
});
