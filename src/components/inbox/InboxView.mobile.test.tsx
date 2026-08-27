import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext";
import InboxView from "./InboxView";
import type { InboxActiveSnapshotController, InboxViewProps } from "./InboxView";
import { searchEmails } from "../../api";
import {
  makeActiveSnapshot,
  makeInboxAccounts,
  makeLiveInboxEmail,
} from "./test-utils/inboxFixtures";
import { resetInboxSession } from "./useInboxSessionState";
import type { EmailSearchClientResponse, EmailSearchResult } from "../../../shared/types/email";

type RenderInboxOptions = Omit<Partial<InboxViewProps>, "customize"> & {
  customize?: Record<string, unknown>;
};

function makeSearchResult(overrides: Partial<EmailSearchResult>): EmailSearchResult {
  return {
    uid: "search-result",
    from_name: null,
    from_address: null,
    subject: null,
    body_snippet: null,
    subject_highlight: null,
    body_highlight: null,
    email_date: null,
    read: false,
    web_url: null,
    account_id: "gmail-personal",
    account_label: "Personal",
    account_email: "personal@example.com",
    account_color: "#cba6da",
    account_icon: "Mail",
    ...overrides,
  };
}

function makeSearchResponse(overrides: Partial<EmailSearchClientResponse>): EmailSearchClientResponse {
  return {
    accounts: [],
    total: 0,
    offset: 0,
    has_more: false,
    capped: false,
    query: "",
    ...overrides,
  };
}

const activeSnapshotMock = vi.hoisted(() => ({
  state: {
    snapshot: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  } as InboxActiveSnapshotController,
}));

// test-architecture: allow-boundary-mock -- rendered mobile Inbox workflows keep the real controller, snapshot hook input, rows, reader, and accessibility state while replacing only authenticated HTTP calls.
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
}: RenderInboxOptions = {}) {
  const briefing = {
    emails: {
      summary: "Handle the approval first, then everything else can wait.",
      accounts: makeInboxAccounts(),
    },
  };

  function Harness() {
    return <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
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
        activeSnapshot={activeSnapshotMock.state.snapshot || activeSnapshotMock.state.loading ? activeSnapshotMock.state : undefined}
        liveEmails={liveEmails}
        snoozedEntries={snoozedEntries}
        resurfacedEntries={resurfacedEntries}
        onRefresh={() => {}}
        seedSelectedId={seedSelectedId}
        isMobile={isMobile}
      />
    </DashboardProvider>;
  }
  return render(<Harness />);
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
    vi.mocked(searchEmails).mockReset();
    vi.mocked(searchEmails).mockResolvedValue(makeSearchResponse({
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            makeSearchResult({
              uid: "gmail-personal-amazon-1",
              from_name: "Amazon.com",
              from_address: "store-news@amazon.com",
              subject: "Amazon order from last month",
              body_snippet: "Your historical order is indexed.",
              email_date: "2026-04-02T12:00:00.000Z",
              read: true,
            }),
          ],
        },
      ],
      total: 1,
      query: "amazon",
    }));

    renderInbox({ isMobile: true });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon" },
    });

    expect(await screen.findByText("Amazon order from last month")).toBeTruthy();
    expect(screen.queryByText("Budget dinner plans")).toBeNull();
  });

  it("shows the true indexed-search total in the mobile summary line, not just the loaded page size", async () => {
    vi.mocked(searchEmails).mockReset();
    vi.mocked(searchEmails).mockResolvedValue(makeSearchResponse({
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            makeSearchResult({
              uid: "gmail-personal-amazon-1",
              from_name: "Amazon.com",
              from_address: "store-news@amazon.com",
              subject: "Amazon order from last month",
              body_snippet: "Your historical order is indexed.",
              email_date: "2026-04-02T12:00:00.000Z",
              read: true,
            }),
          ],
        },
      ],
      total: 42,
      has_more: true,
      query: "amazon",
    }));

    renderInbox({ isMobile: true });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon" },
    });

    expect(await screen.findByText("1 of 42 indexed")).toBeTruthy();
  });

  it("renders a Show more results button on mobile when more indexed results are available and wires the click through", async () => {
    vi.mocked(searchEmails).mockReset();
    vi.mocked(searchEmails).mockResolvedValueOnce(makeSearchResponse({
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            makeSearchResult({
              uid: "gmail-personal-amazon-1",
              from_name: "Amazon.com",
              from_address: "store-news@amazon.com",
              subject: "Amazon order from last month",
              body_snippet: "Your historical order is indexed.",
              email_date: "2026-04-02T12:00:00.000Z",
              read: true,
            }),
          ],
        },
      ],
      total: 42,
      has_more: true,
      query: "amazon",
    })).mockResolvedValueOnce(makeSearchResponse({
      accounts: [{
        account_id: "gmail-personal", account_label: "Personal", account_email: "personal@example.com",
        account_color: "#cba6da", account_icon: "Mail", results: [
          makeSearchResult({ uid: "gmail-personal-amazon-1", subject: "Amazon order from last month", email_date: "2026-04-02T12:00:00.000Z" }),
          makeSearchResult({ uid: "gmail-personal-amazon-2", subject: "Amazon return label", email_date: "2026-04-01T12:00:00.000Z" }),
        ],
      }],
      total: 42, has_more: true, query: "amazon",
    }));

    renderInbox({ isMobile: true });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "amazon" },
    });

    expect(await screen.findByText("Amazon order from last month")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Show more results" });
    fireEvent.click(button);

    expect(await screen.findByText("Amazon return label")).toBeTruthy();
  });

  it("shows skeleton rows instead of search chrome or empty copy while mobile indexed search is loading", async () => {
    vi.mocked(searchEmails).mockResolvedValueOnce({ accounts: [], results: [], total: 0, offset: 0, has_more: false, capped: false, query: "tuition" });

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
    vi.mocked(searchEmails).mockResolvedValueOnce({ accounts: [], results: [], total: 0, offset: 0, has_more: false, capped: false, query: "tuition" });

    renderInbox({ isMobile: true, liveEmails: [] });

    fireEvent.change(screen.getByLabelText("Search indexed mail"), {
      target: { value: "tuition" },
    });

    await waitFor(() => {
      expect(screen.getByText("No indexed mail matches")).toBeTruthy();
    });
    expect(screen.queryByTestId("inbox-mobile-search-skeleton")).toBeNull();
  });

  it("keeps desktop-only Alfred entry points out of mobile Inbox", () => {
    renderInbox({ isMobile: true, liveEmails: [] });

    expect(screen.queryByRole("button", { name: "Ask Alfred" })).toBeNull();
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

  it("forces an empty-to-text live-region transition for repeated identical read announcements", async () => {
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
          activeSnapshot={activeSnapshotMock.state}
          liveEmails={[]}
          liveReadOverrides={readOverrides}
          onLiveReadOverrideChange={(uid, read) => {
            setReadOverrides((prev) => ({ ...prev, [uid]: read }));
          }}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onRefresh={() => {}}
          seedSelectedId="snapshot-msg-1"
          isMobile
        />
      );
    }

    activeSnapshotMock.state = {
      snapshot: makeActiveSnapshot({
        lanes: {
          needs_attention: [
            {
              id: 11,
              snapshot_item_id: 11,
              uid: "snapshot-msg-1",
              email_id: "snapshot-msg-1",
              account_id: "gmail-work",
              lane: "needs_attention",
              subject: "Snapshot action",
              from_name: "Dana",
              from_address: "dana@example.com",
              date: "2026-05-03T15:00:00.000Z",
              read: true,
            },
            {
              id: 12,
              snapshot_item_id: 12,
              uid: "snapshot-msg-2",
              email_id: "snapshot-msg-2",
              account_id: "gmail-work",
              lane: "needs_attention",
              subject: "Second snapshot action",
              from_name: "Morgan",
              from_address: "morgan@example.com",
              date: "2026-05-03T14:00:00.000Z",
              read: true,
            },
          ],
          fyi: [],
          noise: [],
        },
      }),
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
    fireEvent.click(screen.getByRole("button", { name: /Actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mark unread/i }));

    // The silent mutation still announces through an empty→text live-region transition.
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Marked as unread"));

    // A repeated announcement must clear first so assistive tech hears it again.
    fireEvent.click(screen.getByText("Second snapshot action"));
    fireEvent.click(screen.getByRole("button", { name: /Actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mark unread/i }));

    expect(screen.getByRole("status").textContent).toBe("");

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Marked as unread"));
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

  it("counts only the core lane chips instead of repeating snapshot and default-account summaries on mobile", () => {
    const snapshot = makeActiveSnapshot();
    const lanes = snapshot.lanes;
    const needsItem = lanes?.needs_attention?.[0];
    if (!lanes || !needsItem) throw new Error("Expected the active snapshot fixture to include a Needs item");
    const laneItem = (id: number, lane: string) => ({
      ...needsItem,
      id,
      snapshot_item_id: id,
      uid: `snapshot-msg-${id}`,
      email_id: `snapshot-msg-${id}`,
      lane,
    });
    lanes.queued = [laneItem(14, "queued")];
    snapshot.carryover = [laneItem(15, "needs_attention")];
    lanes.catch_up = [laneItem(16, "catch_up")];
    lanes.handled = [laneItem(17, "handled")];
    lanes.untriaged_read = [{ ...laneItem(18, "untriaged_read"), read: true }];
    lanes.fyi = [{
      ...needsItem,
      id: 12,
      snapshot_item_id: 12,
      uid: "snapshot-msg-2",
      email_id: "snapshot-msg-2",
      lane: "fyi",
    }];
    lanes.noise = [{
      ...needsItem,
      id: 13,
      snapshot_item_id: 13,
      uid: "snapshot-msg-3",
      email_id: "snapshot-msg-3",
      lane: "noise",
    }];

    activeSnapshotMock.state = {
      snapshot,
      loading: false,
      error: null,
      refresh: vi.fn(),
    };

    renderInbox({ isMobile: true, liveEmails: [] });

    expect(screen.getByText("Current snapshot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs, 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "FYI, 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Noise, 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Queue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Carry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Catch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Handled" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Read" })).toBeNull();
    expect(screen.queryByText(/1 email across 1 account/i)).toBeNull();
    expect(screen.queryByText("All accounts")).toBeNull();
    expect(screen.queryByText("1 shown")).toBeNull();
    expect(screen.queryByText("Handle the approval first, then everything else can wait.")).toBeNull();
    expect(screen.queryByText(/Snapshot updated/i)).toBeNull();
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
