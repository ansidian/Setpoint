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
    searchEmails: vi.fn().mockResolvedValue({ accounts: [] }),
  };
});

vi.mock("../../hooks/useActiveSnapshot", () => ({
  default: () => activeSnapshotMock.state,
}));

vi.mock("../bills/BillBadge.jsx", () => ({
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
      />
    </DashboardProvider>,
  );
}

describe("InboxView mobile", () => {
  it("uses the persisted FTS email search instead of local inbox filtering", async () => {
    searchEmails.mockResolvedValueOnce({
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
      expect(searchEmails).toHaveBeenCalledWith("amazon");
    });
    expect(await screen.findByText("Amazon order from last month")).toBeTruthy();
    expect(screen.queryByText("Budget dinner plans")).toBeNull();
  });

  it("respects a seedSelectedId on mobile", () => {
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
          preview: "Just arrived after the briefing.",
          body_preview: "Just arrived after the briefing.",
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

    expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();

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

  it("deselects the active desktop email on browser back", () => {
    renderInbox({ isMobile: false });

    fireEvent.click(screen.getByText("Project budget sign-off"));
    expect(screen.getByText("Please approve the revised budget.")).toBeTruthy();

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
