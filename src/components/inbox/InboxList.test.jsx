import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InboxList from "./InboxList.jsx";
import { makeInboxEmail } from "./test-utils/inboxFixtures.js";

vi.mock("./primitives", () => ({
  Avatar: function AvatarMock({ name }) {
    return <span aria-hidden="true">{name?.slice(0, 1)}</span>;
  },
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

function renderInboxList(props = {}) {
  return render(
    <InboxList
      accent="#cba6da"
      emails={[]}
      accountsById={{}}
      selectedId={null}
      onOpen={() => {}}
      density="default"
      layout="swimlanes"
      showPreview
      searchQuery=""
      onSearchChange={() => {}}
      onMarkAllRead={() => {}}
      onRefresh={() => {}}
      totalCount={0}
      unreadCount={0}
      briefingAgoLabel={null}
      briefingGeneratedAt={null}
      searchRef={null}
      {...props}
    />,
  );
}

describe("InboxList", () => {
  it("renders the empty list state with search and sync controls", () => {
    renderInboxList();

    expect(screen.getByLabelText("Search indexed mail")).toBeTruthy();
    expect(screen.getByTitle("Sync now")).toBeTruthy();
    expect(screen.getByText("No emails available")).toBeTruthy();
  });

  it("shows live skeleton rows instead of the empty state while loading live mail", () => {
    renderInboxList({ liveEmailsLoading: true });

    expect(screen.getByTestId("inbox-live-loading-block")).toBeTruthy();
    expect(screen.getByTestId("inbox-live-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("inbox-list-empty-state-card")).toBeNull();
  });

  it("does not show the live skeleton loader while Sync now refreshes active snapshot lanes", () => {
    renderInboxList({ liveEmailsLoading: true, activeSnapshotMode: true });

    expect(screen.queryByTestId("inbox-live-loading-block")).toBeNull();
    expect(screen.queryByTestId("inbox-live-skeleton")).toBeNull();
  });

  it("shows row-shaped live loading cues even when briefing mail is already visible", () => {
    renderInboxList({
      emails: [makeInboxEmail({ id: "email-1", _lane: "action" })],
      liveEmailsLoading: true,
      totalCount: 1,
      unreadCount: 1,
    });

    expect(screen.getByTestId("inbox-live-loading-block")).toBeTruthy();
    expect(screen.getByTestId("inbox-live-skeleton")).toBeTruthy();
    expect(screen.getByText("Project budget sign-off")).toBeTruthy();
  });

  it("renders active snapshot lanes without the old live triage split", () => {
    renderInboxList({
      emails: [
        makeInboxEmail({ id: "carry-1", subject: "Carryover contract", date: "2026-05-02T12:00:00.000Z", _lane: "carryover" }),
        makeInboxEmail({ id: "need-1", subject: "Needs attention deck", date: "2026-05-03T12:00:00.000Z", _lane: "needs_attention" }),
        makeInboxEmail({ id: "fyi-1", subject: "FYI launch note", date: "2026-05-03T13:00:00.000Z", _lane: "fyi" }),
        makeInboxEmail({ id: "noise-1", subject: "Noise promo", date: "2026-05-03T14:00:00.000Z", _lane: "noise" }),
      ],
      totalCount: 4,
      unreadCount: 4,
      activeSnapshotMode: true,
      snapshotCategories: [{ category: "finance", count: 1 }],
    });

    expect(screen.getByText("Carryover")).toBeTruthy();
    expect(screen.getByText("Needs Attention")).toBeTruthy();
    expect(screen.getByText("FYI")).toBeTruthy();
    expect(screen.getByText("Noise")).toBeTruthy();
    expect(screen.getByText("finance")).toBeTruthy();
    expect(screen.getByText("Carryover contract")).toBeTruthy();
    expect(screen.getByText("Needs attention deck")).toBeTruthy();
    expect(screen.getByText("FYI launch note")).toBeTruthy();
    expect(screen.queryByText("Not yet triaged")).toBeNull();
  });
});
