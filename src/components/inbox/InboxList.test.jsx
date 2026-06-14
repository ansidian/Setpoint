import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
        makeInboxEmail({ id: "queued-1", subject: "Queued fresh arrival", date: "2026-05-02T11:00:00.000Z", _lane: "queued", _arrivalGraceQueued: true }),
        makeInboxEmail({ id: "carry-1", subject: "Carryover contract", date: "2026-05-02T12:00:00.000Z", _lane: "carryover" }),
	        makeInboxEmail({ id: "need-1", subject: "Needs attention deck", date: "2026-05-03T12:00:00.000Z", _lane: "needs_attention" }),
	        makeInboxEmail({ id: "catch-1", subject: "Catch-up digest", date: "2026-05-03T12:30:00.000Z", _lane: "catch_up" }),
	        makeInboxEmail({ id: "fyi-1", subject: "FYI launch note", date: "2026-05-03T13:00:00.000Z", _lane: "fyi" }),
	        makeInboxEmail({ id: "handled-1", subject: "Handled receipt", date: "2026-05-03T13:30:00.000Z", _lane: "handled" }),
	        makeInboxEmail({ id: "read-1", subject: "Already read arrival", date: "2026-05-03T13:45:00.000Z", _lane: "untriaged_read", _untriagedRead: true, read: true }),
	        makeInboxEmail({ id: "noise-1", subject: "Noise promo", date: "2026-05-03T14:00:00.000Z", _lane: "noise" }),
	      ],
	      totalCount: 8,
	      unreadCount: 6,
      activeSnapshotMode: true,
      snapshotCategories: [{ category: "finance", count: 1 }],
    });

    expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
    expect(screen.getByText("Carryover")).toBeTruthy();
	    expect(screen.getByText("Needs Attention")).toBeTruthy();
	    expect(screen.getByText("Catch-up")).toBeTruthy();
	    expect(screen.getByText("FYI")).toBeTruthy();
	    expect(screen.getByText("Handled")).toBeTruthy();
	    expect(screen.getByText("Untriaged Read")).toBeTruthy();
	    expect(screen.getByText("Noise")).toBeTruthy();
    expect(screen.getByText("Finance")).toBeTruthy();
    expect(screen.getByText("Queued fresh arrival")).toBeTruthy();
    expect(screen.getByText("Carryover contract")).toBeTruthy();
	    expect(screen.getByText("Needs attention deck")).toBeTruthy();
	    expect(screen.getByText("Catch-up digest")).toBeTruthy();
	    expect(screen.getByText("FYI launch note")).toBeTruthy();
	    const laneLabels = screen.getAllByRole("button")
	      .map((button) => button.textContent)
	      .filter((text) => /Queued|Carryover|Needs Attention|Catch-up|FYI|Handled|Untriaged Read|Noise/.test(text));
	    const laneIndex = (label) => laneLabels.findIndex((text) => text.includes(label));
	    expect(laneIndex("Queued")).toBeLessThan(laneIndex("Needs Attention"));
	    expect(laneIndex("Needs Attention")).toBeLessThan(laneIndex("Catch-up"));
	    expect(laneIndex("Catch-up")).toBeLessThan(laneIndex("FYI"));
	    expect(screen.queryByText("Handled receipt")).toBeNull();
	    expect(screen.queryByText("Already read arrival")).toBeNull();
	    fireEvent.click(screen.getByText("Handled"));
	    expect(screen.getByText("Handled receipt")).toBeTruthy();
	    fireEvent.click(screen.getByText("Untriaged Read"));
	    expect(screen.getByText("Already read arrival")).toBeTruthy();
	    expect(screen.queryByText("Not yet triaged")).toBeNull();
	  });

  it("shows unread noise in the collapsed Noise lane header", () => {
    renderInboxList({
      emails: [
        makeInboxEmail({ id: "noise-unread-1", subject: "Unread sale", _lane: "noise", read: false }),
        makeInboxEmail({ id: "noise-read-1", subject: "Read promo", _lane: "noise", read: true }),
      ],
      totalCount: 2,
      unreadCount: 1,
      noiseUnreadCount: 1,
      activeSnapshotMode: true,
    });

    expect(screen.getByText("Noise")).toBeTruthy();
    expect(screen.getByText("1 unread")).toBeTruthy();
    expect(screen.queryByText("Unread sale")).toBeNull();
  });

  it("collapses low-priority active snapshot categories into a More menu", () => {
    const onCategoryFilterChange = vi.fn();

    renderInboxList({
      activeSnapshotMode: true,
      snapshotCategories: [
        { category: "marketing", count: 20 },
        { category: "finance", count: 1 },
        { category: "security", count: 2 },
        { category: "legal", count: 3 },
        { category: "school", count: 8 },
        { category: "work", count: 9 },
      ],
      onCategoryFilterChange,
    });

    const strip = screen.getByTestId("inbox-category-filter-strip");
    expect(strip.style.overflowX).toBe("hidden");
    expect(within(strip).getByRole("button", { name: /^All$/i })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: /Security 2/i })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: /Legal 3/i })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: /Finance 1/i })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: /Work 9/i })).toBeTruthy();
    expect(within(strip).queryByRole("button", { name: /Marketing 20/i })).toBeNull();

    fireEvent.click(within(strip).getByRole("button", { name: /More 2/i }));

    const menu = screen.getByRole("menu", { name: /more inbox categories/i });
    expect(within(menu).getByRole("menuitemradio", { name: /School 8/i })).toBeTruthy();
    expect(within(menu).getByRole("menuitemradio", { name: /Marketing 20/i })).toBeTruthy();
    expect(within(menu).queryByRole("menuitemradio", { name: /Security 2/i })).toBeNull();

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Marketing 20/i }));
    expect(onCategoryFilterChange).toHaveBeenCalledWith("marketing");
    expect(screen.queryByRole("menu", { name: /more inbox categories/i })).toBeNull();
  });

  it("marks a hidden active category through the More trigger and only All clears it", () => {
    const onCategoryFilterChange = vi.fn();

    renderInboxList({
      activeSnapshotMode: true,
      categoryFilter: "marketing",
      snapshotCategories: [
        { category: "finance", count: 1 },
        { category: "security", count: 2 },
        { category: "legal", count: 3 },
        { category: "school", count: 8 },
        { category: "marketing", count: 20 },
      ],
      onCategoryFilterChange,
    });

    const strip = screen.getByTestId("inbox-category-filter-strip");
    expect(within(strip).getByRole("button", { name: /Marketing · More/i }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(strip).getByRole("button", { name: /Marketing · More/i }));
    const menu = screen.getByRole("menu", { name: /more inbox categories/i });
    const activeMenuItem = within(menu).getByRole("menuitemradio", { name: /Marketing 20/i });
    expect(activeMenuItem.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(activeMenuItem);
    expect(onCategoryFilterChange).not.toHaveBeenCalledWith("marketing");

    fireEvent.click(within(strip).getByRole("button", { name: /^All$/i }));
    expect(onCategoryFilterChange).toHaveBeenCalledWith("__all");
  });

  it("shows indexed-search skeleton rows while a desktop search is unresolved", () => {
    renderInboxList({
      indexedSearchActive: true,
      indexedSearchLoading: true,
      searchQuery: "tuition",
      emails: [],
    });

    expect(screen.getByTestId("inbox-search-skeleton")).toBeTruthy();
    expect(screen.queryByText("Searching persisted mail index...")).toBeNull();
    expect(screen.queryByTestId("inbox-list-empty-state-card")).toBeNull();
  });

  it("does not render the snapshot age label on desktop", () => {
    renderInboxList({
      briefingAgoLabel: "Snapshot updated 2h ago",
    });

    expect(screen.queryByText("Snapshot updated 2h ago")).toBeNull();
  });

  it("shows a quiet indexed-search empty state only after loading settles", () => {
    renderInboxList({
      indexedSearchActive: true,
      indexedSearchLoading: false,
      searchQuery: "tuition",
      emails: [],
    });

    expect(screen.queryByTestId("inbox-search-skeleton")).toBeNull();
    expect(screen.getByText("No indexed mail matches")).toBeTruthy();
  });

  it("hands the search query off to alfred on Cmd+Enter", () => {
    const onAskAlfred = vi.fn();

    renderInboxList({
      searchQuery: "amazon return",
      onAskAlfred,
    });

    fireEvent.keyDown(screen.getByLabelText("Search indexed mail"), {
      key: "Enter",
      metaKey: true,
    });

    expect(onAskAlfred).toHaveBeenCalledWith("amazon return");
    expect(screen.queryByTestId("inbox-ai-confirmation")).toBeNull();
  });
});
