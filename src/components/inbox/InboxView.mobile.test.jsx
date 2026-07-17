import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import InboxView from "./InboxView.jsx";
import { searchEmails, markEmailAsRead, markEmailAsUnread } from "../../api";
import {
  makeActiveSnapshot,
  makeInboxAccounts,
  makeLiveInboxEmail,
} from "./test-utils/inboxFixtures.js";
import { resetInboxSession } from "./useInboxSessionState.js";

function signalOptions() {
  return expect.objectContaining({ signal: expect.any(AbortSignal) });
}

const activeSnapshotMock = vi.hoisted(() => ({
  state: {
    snapshot: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  },
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual("../../api");
  return {
    ...actual,
    getEmailBody: vi.fn().mockResolvedValue({ body: "Loaded email body" }),
    peekEmailBody: vi.fn(() => null),
    markEmailAsRead: vi.fn().mockResolvedValue({}),
    markEmailAsUnread: vi.fn().mockResolvedValue({}),
    trashEmail: vi.fn().mockResolvedValue({}),
    snoozeEmail: vi.fn().mockResolvedValue({}),
    markAllEmailsAsRead: vi.fn().mockResolvedValue({}),
    dismissEmail: vi.fn().mockResolvedValue({}),
    settleArrivalGrace: vi.fn().mockResolvedValue({}),
    searchEmails: vi.fn().mockResolvedValue({ accounts: [] }),
  };
});

vi.mock("../../hooks/useActiveSnapshot", () => ({
  default: () => activeSnapshotMock.state,
}));

vi.mock("../bills/BillBadge", () => ({
  default: function BillBadgeMock() {
    return <div data-testid="bill-badge">Bill badge</div>;
  },
}));

vi.mock("./reader/DraftReply.jsx", () => ({
  default: function DraftReplyMock() {
    return <div data-testid="draft-reply">Draft reply</div>;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetInboxSession();
  window.history.replaceState(null, "", "/");
  activeSnapshotMock.state = {
    snapshot: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
});

function renderInbox({
  isMobile = true,
  seedSelectedId = null,
  customize = {},
  liveEmails = [makeLiveInboxEmail()],
  snoozedEntries = [],
  resurfacedEntries = [],
  onAskAlfred,
} = {}) {
  const briefing = {
    emails: {
      summary: "Handle the approval first, then everything else can wait.",
      accounts: makeInboxAccounts(),
    },
  };

  return render(
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <InboxView
        accent="#cba6da"
        customize={{
          aiVerbosity: "standard",
          showPreview: true,
          inboxDensity: "default",
          sidebarCompact: false,
          inboxLayout: "two-pane",
          inboxGrouping: "swimlanes",
          ...customize,
        }}
        emailAccounts={briefing.emails.accounts}
        briefingSummary={briefing.emails.summary}
        briefingGeneratedAt="2026-04-19 15:00:00"
        liveEmails={liveEmails}
        snoozedEntries={snoozedEntries}
        resurfacedEntries={resurfacedEntries}
        onOpenDashboard={() => {}}
        onRefresh={() => {}}
        seedSelectedId={seedSelectedId}
        isMobile={isMobile}
        onAskAlfred={onAskAlfred}
      />
    </DashboardProvider>,
  );
}

function activateBudgetSnapshot() {
  activeSnapshotMock.state = {
    snapshot: makeActiveSnapshot({
      filters: {
        accounts: [
          {
            account_id: "acc-work",
            label: "Work",
            email: "work@example.com",
            color: "#89dceb",
            icon: "Mail",
            count: 1,
          },
        ],
        categories: [],
      },
      lanes: {
        needs_attention: [{
          id: 11,
          snapshot_item_id: 11,
          uid: "email-action",
          email_id: "email-action",
          account_id: "acc-work",
          lane: "needs_attention",
          subject: "Project budget sign-off",
          from_name: "Dana",
          from_address: "dana@example.com",
          summary: "Need your approval on the revised budget today.",
          date: "2026-04-19T15:30:00.000Z",
          read: false,
        }],
        fyi: [],
        noise: [],
      },
    }),
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
}


describe("InboxView mobile", () => {
  it("uses the persisted FTS email search instead of local inbox filtering", async () => {
    // Self-sufficient mock setup: a sibling test (the skeleton case) queues a
    // searchEmails.mockResolvedValueOnce but asserts on the synchronous loading
    // state and finishes before the 250ms search debounce fires, so its
    // once-value is never consumed. vi.clearAllMocks() in afterEach does NOT
    // drain that queue, so under a perturbed order the leaked value would be
    // popped by this test's search call ahead of our own. mockReset() drains
    // any leaked queue/implementation, and a persistent mockResolvedValue
    // (not ...Once) cannot be consumed out from under us.
    searchEmails.mockReset();
    searchEmails.mockResolvedValue({
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            {
              uid: "gmail-personal-amazon-1",
              from_name: "Amazon.com",
              from_address: "store-news@amazon.com",
              subject: "Amazon order from last month",
              body_snippet: "Your historical order is indexed.",
              email_date: "2026-04-02T12:00:00.000Z",
              read: true,
            },
          ],
        },
      ],
      total: 1,
      query: "amazon",
    });

    renderInbox({ isMobile: true });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon" },
    });

    await waitFor(() => {
      expect(searchEmails).toHaveBeenCalledWith("amazon", 30, signalOptions());
    });
    expect(await screen.findByText("Amazon order from last month")).toBeTruthy();
    expect(screen.queryByText("Budget dinner plans")).toBeNull();
  });

  it("shows the true indexed-search total in the mobile summary line, not just the loaded page size", async () => {
    searchEmails.mockReset();
    searchEmails.mockResolvedValue({
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            {
              uid: "gmail-personal-amazon-1",
              from_name: "Amazon.com",
              from_address: "store-news@amazon.com",
              subject: "Amazon order from last month",
              body_snippet: "Your historical order is indexed.",
              email_date: "2026-04-02T12:00:00.000Z",
              read: true,
            },
          ],
        },
      ],
      total: 42,
      has_more: true,
      query: "amazon",
    });

    renderInbox({ isMobile: true });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon" },
    });

    await waitFor(() => {
      expect(searchEmails).toHaveBeenCalledWith("amazon", 30, signalOptions());
    });
    expect(await screen.findByText("1 of 42 indexed")).toBeTruthy();
  });

  it("renders a Show more results button on mobile when more indexed results are available and wires the click through", async () => {
    searchEmails.mockReset();
    searchEmails.mockResolvedValue({
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            {
              uid: "gmail-personal-amazon-1",
              from_name: "Amazon.com",
              from_address: "store-news@amazon.com",
              subject: "Amazon order from last month",
              body_snippet: "Your historical order is indexed.",
              email_date: "2026-04-02T12:00:00.000Z",
              read: true,
            },
          ],
        },
      ],
      total: 42,
      has_more: true,
      query: "amazon",
    });

    renderInbox({ isMobile: true });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon" },
    });

    await waitFor(() => {
      expect(searchEmails).toHaveBeenCalledWith("amazon", 30, signalOptions());
    });
    expect(await screen.findByText("Amazon order from last month")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Show more results" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(searchEmails).toHaveBeenCalledWith("amazon", 60, signalOptions());
    });
  });

  it("hides the mobile Show more results button when there is nothing more to load", async () => {
    searchEmails.mockReset();
    searchEmails.mockResolvedValue({
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            {
              uid: "gmail-personal-amazon-1",
              from_name: "Amazon.com",
              from_address: "store-news@amazon.com",
              subject: "Amazon order from last month",
              body_snippet: "Your historical order is indexed.",
              email_date: "2026-04-02T12:00:00.000Z",
              read: true,
            },
          ],
        },
      ],
      total: 1,
      has_more: false,
      query: "amazon",
    });

    renderInbox({ isMobile: true });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon" },
    });

    expect(await screen.findByText("Amazon order from last month")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more results" })).toBeNull();
  });

  it("shows skeleton rows instead of search chrome or empty copy while mobile indexed search is loading", async () => {
    searchEmails.mockResolvedValueOnce({ accounts: [], total: 0, query: "tuition" });

    renderInbox({ isMobile: true, liveEmails: [] });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "tuition" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("inbox-mobile-search-skeleton")).toBeTruthy();
    });
    expect(screen.queryByText("Searching persisted mail index...")).toBeNull();
    expect(screen.queryByText("No emails match this view.")).toBeNull();
  });

  it("shows mobile indexed-search empty copy only after search resolves with no results", async () => {
    searchEmails.mockResolvedValueOnce({ accounts: [], total: 0, query: "tuition" });

    renderInbox({ isMobile: true, liveEmails: [] });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "tuition" },
    });

    await waitFor(() => {
      expect(searchEmails).toHaveBeenCalledWith("tuition", 30, signalOptions());
    });
    await waitFor(() => {
      expect(screen.getByText("No indexed mail matches")).toBeTruthy();
    });
    expect(screen.queryByTestId("inbox-mobile-search-skeleton")).toBeNull();
  });

  it("hands the Sparkles button query off to alfred", () => {
    const onAskAlfred = vi.fn();
    renderInbox({ isMobile: true, liveEmails: [], onAskAlfred });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon return" },
    });
    fireEvent.click(screen.getByTestId("inbox-mobile-ask-alfred-trigger"));

    expect(onAskAlfred).toHaveBeenCalledWith("amazon return");
    expect(screen.queryByTestId("inbox-ai-confirmation")).toBeNull();
  });

  it("hands cmd+enter in the mobile search off to alfred", () => {
    const onAskAlfred = vi.fn();
    renderInbox({ isMobile: true, liveEmails: [], onAskAlfred });
    const input = screen.getByLabelText("Search indexed mail");

    fireEvent.change(input, { target: { value: "tuition deadline" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    expect(onAskAlfred).toHaveBeenCalledWith("tuition deadline");
  });

  it("respects a seedSelectedId on mobile", () => {
    activateBudgetSnapshot();

    renderInbox({ isMobile: true, seedSelectedId: "email-action" });

    expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();
    expect(screen.getByText("Project budget sign-off")).toBeTruthy();
  });

  it("closes the reader when marking a selected live email unread", () => {
    renderInbox({
      isMobile: true,
      seedSelectedId: "live-1",
      liveEmails: [
        {
          uid: "live-1",
          subject: "Fresh live ping",
          from: "Morgan",
          from_email: "morgan@example.com",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#89dceb",
          date: "2026-04-19T16:15:00.000Z",
          preview: "Just arrived after the current snapshot.",
          body_preview: "Just arrived after the current snapshot.",
          read: true,
        },
      ],
    });

    expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mark unread/i }));
    expect(screen.queryByTestId("inbox-mobile-reader")).toBeNull();
    expect(screen.getByTestId("inbox-mobile-list")).toBeTruthy();
    expect(screen.getByText("Fresh live ping")).toBeTruthy();
  });

  it("announces a silent toggle-read mutation via a status region and replaces the text on a subsequent toggle", async () => {
    // renderInbox() does not wire onLiveReadOverrideChange to real state, so
    // this test builds its own harness (mirroring the "updates active
    // snapshot read state" test below) where toggling read actually flips
    // the email's read state across a re-render.
    function ReadOverrideHarness() {
      const [readOverrides, setReadOverrides] = useState({});
      return (
        <InboxView
          accent="#cba6da"
          emailAccounts={[]}
          briefingSummary=""
          briefingGeneratedAt="2026-05-03 15:00:00"
          liveEmails={[]}
          liveReadOverrides={readOverrides}
          onLiveReadOverrideChange={(uid, read) => {
            setReadOverrides((prev) => ({ ...prev, [uid]: read }));
          }}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          seedSelectedId="snapshot-msg-1"
          isMobile
        />
      );
    }

    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
        <ReadOverrideHarness />
      </DashboardProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();
    });
    await waitFor(() => {
      expect(markEmailAsRead).toHaveBeenCalledWith("snapshot-msg-1");
    });

    fireEvent.click(screen.getByRole("button", { name: /Actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mark unread/i }));

    // The mutation is silent (no undo toast) but must still land in a live
    // region so assistive tech announces it. The real text is set via a
    // microtask (clear-to-"" then set) so the region always goes through an
    // empty→text transition, even when consecutive announcements repeat the
    // same string — wait for that microtask to flush.
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Marked as unread");
    });

    // Re-open the (now unread) row and toggle it back to read: the status
    // region's text must be replaced, not merely appended to.
    fireEvent.click(screen.getByText("Snapshot action"));
    fireEvent.click(screen.getByRole("button", { name: /Actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mark read/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Marked as read");
    });
  });

  it("updates active snapshot read state immediately when opening and toggling mail", async () => {
    function SnapshotHarness() {
      const [readOverrides, setReadOverrides] = useState({});
      return (
        <InboxView
          accent="#cba6da"
          customize={{
            aiVerbosity: "standard",
            showPreview: true,
            inboxDensity: "default",
            sidebarCompact: false,
            inboxLayout: "two-pane",
            inboxGrouping: "swimlanes",
          }}
          emailAccounts={[]}
          briefingSummary=""
          briefingGeneratedAt="2026-05-03 15:00:00"
          liveEmails={[]}
          liveReadOverrides={readOverrides}
          onLiveReadOverrideChange={(uid, read) => {
            setReadOverrides((prev) => ({ ...prev, [uid]: read }));
          }}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          seedSelectedId="snapshot-msg-1"
          isMobile
        />
      );
    }

    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
        <SnapshotHarness />
      </DashboardProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();
    });

    await waitFor(() => {
      expect(markEmailAsRead).toHaveBeenCalledWith("snapshot-msg-1");
    });

    fireEvent.click(screen.getByRole("button", { name: /Actions/i }));
    expect(screen.getByRole("button", { name: /Mark unread/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mark unread/i }));
    expect(markEmailAsUnread).toHaveBeenCalledWith("snapshot-msg-1");
  });

  it("keeps the desktop inbox path intact", () => {
    renderInbox({ isMobile: false });

    expect(screen.getByTestId("inbox-desktop-view")).toBeTruthy();
    expect(screen.queryByTestId("inbox-mobile-list")).toBeNull();
  });

  it("deselects the active desktop email on browser back", async () => {
    activateBudgetSnapshot();

    renderInbox({ isMobile: false });

    fireEvent.click(screen.getByText("Project budget sign-off"));
    expect(await screen.findByText("Loaded email body")).toBeTruthy();

    const sessionId = window.history.state.eaInboxNav.sessionId;
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", {
        state: { eaInboxNav: { sessionId, selectedId: null } },
      }));
    });

    expect(screen.getByText("Select an email")).toBeTruthy();
  });

  it("uses active snapshot counts instead of stale briefing summary copy on mobile", () => {
    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    renderInbox({ isMobile: true, liveEmails: [] });

    expect(screen.getByText("Active snapshot")).toBeTruthy();
    expect(screen.getByText(/1 email across 1 account/i)).toBeTruthy();
    expect(screen.queryByText("Handle the approval first, then everything else can wait.")).toBeNull();
    expect(screen.queryByText(/Snapshot updated/i)).toBeNull();
  });

  it("shows unread noise as a quiet mobile summary hint", () => {
    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot({
        filters: {
          accounts: [{
            account_id: "gmail-work",
            label: "Work",
            email: "work@example.com",
            color: "#89dceb",
            icon: "Mail",
            count: 1,
          }],
          categories: [],
        },
        lanes: {
          needs_attention: [],
          fyi: [],
          noise: [{
            id: 12,
            snapshot_item_id: 12,
            uid: "noise-unread-1",
            email_id: "noise-unread-1",
            account_id: "gmail-work",
            lane: "noise",
            subject: "Sale digest",
            from_name: "Store",
            from_address: "store@example.com",
            summary: "Low-priority promotion.",
            date: "2026-05-03T15:00:00.000Z",
            read: false,
          }],
        },
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    renderInbox({ isMobile: true, liveEmails: [] });

    expect(screen.getByText((_, element) => element?.textContent === "1 noise unread")).toBeTruthy();
  });

  it("shows a Pinned group label above a pinned row on mobile", () => {
    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot({
        pinned: [{
          uid: "pinned-msg-1",
          pinned_at: "2026-05-03T15:30:00.000Z",
          account_id: "gmail-work",
          subject: "Pinned budget approval",
          from_name: "Dana",
          from_address: "dana@example.com",
          preview: "Keep this handy.",
          date: "2026-05-03T15:00:00.000Z",
          read: false,
        }],
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    renderInbox({ isMobile: true, liveEmails: [] });

    const pinnedLabel = screen.getByText("Pinned");
    const pinnedRow = screen.getByText("Pinned budget approval");
    expect(pinnedLabel.compareDocumentPosition(pinnedRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no Pinned group label on mobile when there are no pins", () => {
    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    renderInbox({ isMobile: true, liveEmails: [] });

    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("shows resurfaced snoozes as fresh live rows in active snapshot mode", () => {
    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot({
        lanes: {
          needs_attention: [{
            id: 11,
            snapshot_item_id: 11,
            uid: "snapshot-msg-1",
            email_id: "snapshot-msg-1",
            account_id: "gmail-work",
            lane: "needs_attention",
            subject: "Original snapshot action",
            from_name: "Dana",
            from_address: "dana@example.com",
            summary: "Needs a response.",
            date: "2026-05-03T15:00:00.000Z",
            read: false,
          }],
          fyi: [],
          noise: [],
        },
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    renderInbox({
      isMobile: true,
      liveEmails: [],
      resurfacedEntries: [{
        uid: "snapshot-msg-1",
        resurfaced_at: Date.parse("2026-05-03T16:00:00.000Z"),
        read: false,
        snapshot: {
          uid: "snapshot-msg-1",
          id: "snapshot-msg-1",
          subject: "Woke from snooze",
          from: "Dana",
          fromEmail: "dana@example.com",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#89dceb",
          date: "2026-05-03T15:00:00.000Z",
          preview: "Back in the inbox.",
          read: false,
        },
      }],
    });

    expect(screen.getByText("Woke from snooze")).toBeTruthy();
    expect(screen.getByText("Snoozed")).toBeTruthy();
    expect(screen.queryByText("Original snapshot action")).toBeNull();
  });
});
