import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InboxList from "./InboxList.jsx";

vi.mock("./EmailRow", () => ({
  default: function EmailRowMock() {
    return <div data-testid="email-row">Email row</div>;
  },
}));

vi.mock("./primitives", () => ({
  Kbd: function KbdMock({ children }) {
    return <kbd>{children}</kbd>;
  },
  StickyHeader: function StickyHeaderMock({ children }) {
    return <div>{children}</div>;
  },
  IconBtn: function IconBtnMock({ children, onClick, title }) {
    return (
      <button type="button" onClick={onClick} title={title}>
        {children}
      </button>
    );
  },
  LaneIcon: function LaneIconMock() {
    return <span aria-hidden="true" />;
  },
}));

afterEach(() => {
  cleanup();
});

describe("InboxList", () => {
  it("renders the empty list state as a bounded square card near the top-left", () => {
    render(
      <InboxList
        accent="#cba6da"
        emails={[]}
        accountsById={{}}
        selectedId={null}
        onOpen={() => {}}
        density="default"
        layout="swimlanes"
        showPreview
        pinnedIds={new Set()}
        searchQuery=""
        onSearchChange={() => {}}
        onMarkAllRead={() => {}}
        onRefresh={() => {}}
        totalCount={0}
        unreadCount={0}
        briefingAgoLabel={null}
        briefingGeneratedAt={null}
        searchRef={null}
      />,
    );

    const card = screen.getByTestId("inbox-list-empty-state-card");
    expect(card.style.width).toBe("100%");
    expect(card.style.aspectRatio).toBe("1 / 1");
    expect(screen.getByText("No emails available")).toBeTruthy();
  });

  it("shows live skeleton rows instead of the empty state while loading live mail", () => {
    render(
      <InboxList
        accent="#cba6da"
        emails={[]}
        accountsById={{}}
        selectedId={null}
        onOpen={() => {}}
        density="default"
        layout="swimlanes"
        showPreview
        pinnedIds={new Set()}
        searchQuery=""
        onSearchChange={() => {}}
        onMarkAllRead={() => {}}
        onRefresh={() => {}}
        liveEmailsLoading
        totalCount={0}
        unreadCount={0}
        briefingAgoLabel={null}
        briefingGeneratedAt={null}
        searchRef={null}
      />,
    );

    expect(screen.getByTestId("inbox-live-loading-block")).toBeTruthy();
    expect(screen.getByTestId("inbox-live-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("inbox-list-empty-state-card")).toBeNull();
  });

  it("uses active snapshot loading copy while Sync now refreshes triage lanes", () => {
    render(
      <InboxList
        accent="#cba6da"
        emails={[]}
        accountsById={{}}
        selectedId={null}
        onOpen={() => {}}
        density="default"
        layout="swimlanes"
        showPreview
        pinnedIds={new Set()}
        searchQuery=""
        onSearchChange={() => {}}
        onMarkAllRead={() => {}}
        onRefresh={() => {}}
        liveEmailsLoading
        totalCount={0}
        unreadCount={0}
        briefingAgoLabel={null}
        briefingGeneratedAt={null}
        searchRef={null}
        activeSnapshotMode
      />,
    );

    const loadingBlock = screen.getByTestId("inbox-live-loading-block");
    expect(loadingBlock.textContent).toContain("Syncing active snapshot");
    expect(loadingBlock.textContent).not.toContain("Checking live mail");
  });

  it("shows row-shaped live loading cues even when briefing mail is already visible", () => {
    render(
      <InboxList
        accent="#cba6da"
        emails={[{
          id: "email-1",
          uid: "email-1",
          date: "2026-04-20T12:00:00.000Z",
          _lane: "action",
        }]}
        accountsById={{}}
        selectedId={null}
        onOpen={() => {}}
        density="default"
        layout="swimlanes"
        showPreview
        pinnedIds={new Set()}
        searchQuery=""
        onSearchChange={() => {}}
        onMarkAllRead={() => {}}
        onRefresh={() => {}}
        liveEmailsLoading
        totalCount={1}
        unreadCount={1}
        briefingAgoLabel={null}
        briefingGeneratedAt={null}
        searchRef={null}
      />,
    );

    expect(screen.getByTestId("inbox-live-loading-block")).toBeTruthy();
    expect(screen.getByTestId("inbox-live-skeleton")).toBeTruthy();
    expect(screen.getByTestId("email-row")).toBeTruthy();
  });

  it("renders active snapshot lanes without the old live triage split", () => {
    render(
      <InboxList
        accent="#cba6da"
        emails={[
          { id: "carry-1", uid: "carry-1", date: "2026-05-02T12:00:00.000Z", _lane: "carryover" },
          { id: "need-1", uid: "need-1", date: "2026-05-03T12:00:00.000Z", _lane: "needs_attention" },
          { id: "fyi-1", uid: "fyi-1", date: "2026-05-03T13:00:00.000Z", _lane: "fyi" },
          { id: "noise-1", uid: "noise-1", date: "2026-05-03T14:00:00.000Z", _lane: "noise" },
        ]}
        accountsById={{}}
        selectedId={null}
        onOpen={() => {}}
        density="default"
        layout="swimlanes"
        showPreview
        pinnedIds={new Set()}
        searchQuery=""
        onSearchChange={() => {}}
        onMarkAllRead={() => {}}
        onRefresh={() => {}}
        totalCount={4}
        unreadCount={4}
        briefingAgoLabel={null}
        briefingGeneratedAt={null}
        searchRef={null}
        activeSnapshotMode
        snapshotCategories={[{ category: "finance", count: 1 }]}
      />,
    );

    expect(screen.getByText("Carryover")).toBeTruthy();
    expect(screen.getByText("Needs Attention")).toBeTruthy();
    expect(screen.getByText("FYI")).toBeTruthy();
    expect(screen.getByText("Noise")).toBeTruthy();
    expect(screen.getByText("finance")).toBeTruthy();
    expect(screen.queryByText("Not yet triaged")).toBeNull();
  });
});
