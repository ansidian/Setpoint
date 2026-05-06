import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import InboxView from "./InboxView.jsx";
import {
  dismissEmail,
  dismissSnapshotItemForToday,
  markSnapshotItemHandled,
  moveSnapshotItemLane,
  reopenSnapshotItem,
  snoozeEmail,
  trashEmail,
} from "../../api";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures.js";

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
    moveSnapshotItemLane: vi.fn().mockResolvedValue({}),
	    dismissSnapshotItemForToday: vi.fn().mockResolvedValue({}),
	    markSnapshotItemHandled: vi.fn().mockResolvedValue({}),
	    reopenSnapshotItem: vi.fn().mockResolvedValue({}),
	  };
	});

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
  vi.clearAllMocks();
});

function makeSessionSnapshot(includeAction = true) {
  return makeActiveSnapshot({
    filters: {
      accounts: [
        {
          account_id: "acc-work",
          label: "Work",
          email: "work@example.com",
          color: "#89dceb",
          icon: "Mail",
          count: includeAction ? 1 : 0,
        },
        {
          account_id: "acc-personal",
          label: "Personal",
          email: "personal@example.com",
          color: "#cba6da",
          icon: "Mail",
          count: 1,
        },
      ],
      categories: [],
    },
    lanes: {
      needs_attention: includeAction
        ? [{
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
          }]
        : [],
      fyi: [{
        id: 12,
        snapshot_item_id: 12,
        uid: "email-fyi",
        email_id: "email-fyi",
        account_id: "acc-personal",
        lane: "fyi",
        subject: "Budget dinner plans",
        from_name: "Chris",
        from_address: "chris@example.com",
        summary: "Checking whether Sunday still works.",
        date: "2026-04-19T14:00:00.000Z",
        read: false,
      }],
      noise: [],
    },
  });
}

function InboxSessionHarness({ initialSelectedId = null }) {
  const [showInbox, setShowInbox] = useState(true);
  const [seedSelectedId, setSeedSelectedId] = useState(null);
  const [snapshot, setSnapshot] = useState(() => makeSessionSnapshot(true));
  const [sessionState, setSessionState] = useState({
    accountId: "__all",
    lane: "__all",
    search: "",
    selectedId: initialSelectedId,
  });

  const briefing = {
    emails: {
      summary: "Handle the approval first, then everything else can wait.",
      accounts: [],
    },
  };
  const activeSnapshot = {
    snapshot,
    loading: false,
    error: null,
    refresh: vi.fn(),
    sync: vi.fn(),
  };

  return (
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <button type="button" onClick={() => setShowInbox((prev) => !prev)}>
        Toggle inbox mount
      </button>
      <button type="button" onClick={() => setSeedSelectedId("email-action")}>
        Seed action email
      </button>
      <button type="button" onClick={() => setSnapshot(makeSessionSnapshot(false))}>
        Remove action email
      </button>
      {showInbox ? (
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
          briefingSummary={briefing.emails.summary}
          briefingGeneratedAt="2026-04-19 15:00:00"
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          seedSelectedId={seedSelectedId}
          sessionState={sessionState}
          onSessionStateChange={setSessionState}
          isMobile
        />
      ) : (
        <div data-testid="dashboard-placeholder">Dashboard</div>
      )}
    </DashboardProvider>
  );
}

describe("InboxView session state", () => {
  it("restores the selected reader across unmount and remount", async () => {
    render(<InboxSessionHarness />);

    fireEvent.click(screen.getByText("Project budget sign-off"));
    expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox mount" }));
    expect(screen.getByTestId("dashboard-placeholder")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox mount" }));
    expect(await screen.findByTestId("inbox-mobile-reader")).toBeTruthy();
    expect(screen.getByText("Project budget sign-off")).toBeTruthy();
  });

  it("lets a new seedSelectedId override the stored selection", async () => {
    render(<InboxSessionHarness initialSelectedId="email-fyi" />);

    expect(await screen.findByTestId("inbox-mobile-reader")).toBeTruthy();
    expect(screen.getByText("Budget dinner plans")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seed action email" }));

    await waitFor(() => {
      expect(screen.getByText("Project budget sign-off")).toBeTruthy();
    });
  });

  it("clears the stored selection when the selected email disappears", async () => {
    render(<InboxSessionHarness initialSelectedId="email-action" />);

    expect(await screen.findByTestId("inbox-mobile-reader")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove action email" }));

    await waitFor(() => {
      expect(screen.queryByTestId("inbox-mobile-reader")).toBeNull();
      expect(screen.getByTestId("inbox-mobile-list")).toBeTruthy();
    });
  });

  it("trashes active snapshot email through provider removal without dismissing locally", async () => {
    const refreshSnapshot = vi.fn().mockResolvedValue({});
    const activeSnapshot = {
      snapshot: {
        snapshot: { id: 77, updated_at: "2026-05-03T15:00:00.000Z" },
        filters: {
          accounts: [{
            account_id: "gmail-a",
            label: "Work",
            email: "work@example.com",
            color: "#89dceb",
            icon: "Mail",
            count: 1,
          }],
          categories: [],
        },
        carryover: [],
        lanes: {
          needs_attention: [{
            id: 42,
            snapshot_item_id: 42,
            triage_id: 8,
            account_id: "gmail-a",
            email_id: "gmail-a-msg-1",
            uid: "gmail-a-msg-1",
            lane: "needs_attention",
            subject: "Review the lease",
            from_name: "Dana",
            from_address: "dana@example.com",
            summary: "Needs your review.",
            email_date: "2026-05-03T14:00:00.000Z",
            read: false,
          }],
          fyi: [],
          noise: [],
        },
      },
      loading: false,
      error: null,
      refresh: refreshSnapshot,
      sync: vi.fn(),
    };
    const [sessionState, setSessionState] = [
      {
        accountId: "__all",
        lane: "__all",
        search: "",
        selectedId: "gmail-a-msg-1",
      },
      vi.fn(),
    ];

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
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
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={sessionState}
          onSessionStateChange={setSessionState}
        />
      </DashboardProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /trash email/i }));

    expect(trashEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(dismissEmail).not.toHaveBeenCalled();
  });

  it("does not render briefing mail while controlled active snapshot is loading", () => {
    const activeSnapshot = {
      snapshot: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
      sync: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
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
          briefingSummary="Prior summary"
          briefingGeneratedAt="2026-05-03 15:00:00"
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={{
            accountId: "__all",
            lane: "__all",
            search: "",
            selectedId: null,
          }}
          onSessionStateChange={() => {}}
        />
      </DashboardProvider>,
    );

    expect(screen.queryByText("Project budget sign-off")).toBeNull();
    expect(screen.queryByText("Checking live mail")).toBeNull();
  });

  it("refreshes active snapshot when a stale handled action is rejected", async () => {
    const refreshSnapshot = vi.fn().mockResolvedValue({});
    markSnapshotItemHandled.mockRejectedValueOnce(
      Object.assign(new Error("Active snapshot item not found"), { status: 404 }),
    );
    const activeSnapshot = {
      snapshot: {
        snapshot: { id: 77, updated_at: "2026-05-03T15:00:00.000Z" },
        filters: {
          accounts: [{
            account_id: "gmail-a",
            label: "Work",
            email: "work@example.com",
            color: "#89dceb",
            icon: "Mail",
            count: 1,
          }],
          categories: [],
        },
        carryover: [],
        lanes: {
          needs_attention: [{
            id: 42,
            snapshot_item_id: 42,
            triage_id: 8,
            account_id: "gmail-a",
            email_id: "gmail-a-msg-1",
            uid: "gmail-a-msg-1",
            lane: "needs_attention",
            subject: "Review the lease",
            from_name: "Dana",
            from_address: "dana@example.com",
            summary: "Needs your review.",
            email_date: "2026-05-03T14:00:00.000Z",
            read: false,
          }],
          fyi: [],
          noise: [],
        },
      },
      loading: false,
      error: null,
      refresh: refreshSnapshot,
      sync: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
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
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={{
            accountId: "__all",
            lane: "__all",
            search: "",
            selectedId: "gmail-a-msg-1",
          }}
          onSessionStateChange={() => {}}
        />
      </DashboardProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /mark handled/i }));

    await waitFor(() => {
      expect(refreshSnapshot).toHaveBeenCalled();
    });
  });

  it("moves an active snapshot row to another lane immediately and refreshes afterward", async () => {
    let resolveMove;
    moveSnapshotItemLane.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMove = resolve;
    }));
    const refreshSnapshot = vi.fn().mockResolvedValue({});
    const activeSnapshot = {
      snapshot: makeActiveSnapshot({
        filters: {
          accounts: [{
            account_id: "gmail-a",
            label: "Work",
            email: "work@example.com",
            color: "#89dceb",
            icon: "Mail",
            count: 1,
          }],
          categories: [],
        },
        lanes: {
          needs_attention: [{
            id: 42,
            snapshot_item_id: 42,
            triage_id: 8,
            account_id: "gmail-a",
            email_id: "gmail-a-msg-1",
            uid: "gmail-a-msg-1",
            lane: "needs_attention",
            subject: "Review the lease",
            from_name: "Dana",
            from_address: "dana@example.com",
            summary: "Needs your review.",
            email_date: "2026-05-03T14:00:00.000Z",
            read: false,
          }],
          fyi: [],
          noise: [],
        },
      }),
      loading: false,
      error: null,
      refresh: refreshSnapshot,
      sync: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
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
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={{
            accountId: "__all",
            lane: "__all",
            search: "",
            selectedId: "gmail-a-msg-1",
          }}
          onSessionStateChange={() => {}}
        />
      </DashboardProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /move to fyi/i }));

    expect(moveSnapshotItemLane).toHaveBeenCalledWith(42, "fyi");
    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();
    expect(screen.getByRole("button", { name: /move to needs attention/i })).toBeTruthy();

    resolveMove({});
    await waitFor(() => {
      expect(refreshSnapshot).toHaveBeenCalled();
    });
  });

  it("hides an active snapshot row immediately when dismissed", async () => {
    dismissSnapshotItemForToday.mockImplementationOnce(() => new Promise(() => {}));
    const activeSnapshot = {
      snapshot: makeActiveSnapshot({
        lanes: {
          needs_attention: [{
            id: 42,
            snapshot_item_id: 42,
            triage_id: 8,
            account_id: "gmail-work",
            email_id: "gmail-a-msg-1",
            uid: "gmail-a-msg-1",
            lane: "needs_attention",
            subject: "Review the lease",
            from_name: "Dana",
            from_address: "dana@example.com",
            summary: "Needs your review.",
            email_date: "2026-05-03T14:00:00.000Z",
            read: false,
          }],
          fyi: [],
          noise: [],
        },
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
      sync: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
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
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={{
            accountId: "__all",
            lane: "__all",
            search: "",
            selectedId: "gmail-a-msg-1",
          }}
          onSessionStateChange={() => {}}
        />
      </DashboardProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /dismiss from today/i }));

    expect(dismissSnapshotItemForToday).toHaveBeenCalledWith(42);
    await waitFor(() => {
      expect(screen.getByText("Select an email")).toBeTruthy();
    });
    expect(screen.queryByText("Review the lease")).toBeNull();
  });

	  it("moves handled active snapshot rows to the Handled lane and suppresses duplicate clicks while pending", async () => {
    markSnapshotItemHandled.mockImplementationOnce(() => new Promise(() => {}));
    const activeSnapshot = {
      snapshot: makeActiveSnapshot(),
      loading: false,
      error: null,
      refresh: vi.fn(),
      sync: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
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
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={{
            accountId: "__all",
            lane: "__all",
            search: "",
            selectedId: "snapshot-msg-1",
          }}
          onSessionStateChange={() => {}}
        />
      </DashboardProvider>,
    );

    const handledButton = await screen.findByRole("button", { name: /mark handled/i });
    fireEvent.click(handledButton);
    fireEvent.click(handledButton);

	    expect(markSnapshotItemHandled).toHaveBeenCalledTimes(1);
	    await waitFor(() => {
	      expect(screen.getByRole("button", { name: /reopen/i })).toBeTruthy();
	    });
	    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
	    expect(screen.getByText("Snapshot action")).toBeTruthy();
	    expect(reopenSnapshotItem).not.toHaveBeenCalled();
	  });

	  it("reopens handled active snapshot rows through the controller", async () => {
	    const activeSnapshot = {
	      snapshot: makeActiveSnapshot({
	        lanes: {
	          needs_attention: [],
	          fyi: [],
	          handled: [{
	            id: 11,
	            snapshot_item_id: 11,
	            uid: "snapshot-msg-1",
	            email_id: "snapshot-msg-1",
	            account_id: "gmail-work",
	            lane: "needs_attention",
	            handled_at: "2026-05-03T16:10:00.000Z",
	            subject: "Snapshot action",
	            from_name: "Dana",
	            from_address: "dana@example.com",
	            summary: "Needs a response.",
	            date: "2026-05-03T15:00:00.000Z",
	            read: false,
	          }],
	          noise: [],
	        },
	      }),
	      loading: false,
	      error: null,
	      refresh: vi.fn(),
	      sync: vi.fn(),
	    };

	    render(
	      <DashboardProvider
	        briefing={{ emails: { accounts: [] } }}
	        setBriefing={() => {}}
	        setCalendarDeadlines={() => {}}
	      >
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
	          activeSnapshot={activeSnapshot}
	          liveEmails={[]}
	          snoozedEntries={[]}
	          resurfacedEntries={[]}
	          onOpenDashboard={() => {}}
	          onRefresh={() => {}}
	          sessionState={{
	            accountId: "__all",
	            lane: "__all",
	            search: "",
	            selectedId: "snapshot-msg-1",
	          }}
	          onSessionStateChange={() => {}}
	        />
	      </DashboardProvider>,
	    );

	    fireEvent.click(await screen.findByRole("button", { name: /reopen/i }));

	    expect(reopenSnapshotItem).toHaveBeenCalledWith(11);
	    await waitFor(() => {
	      expect(screen.getByRole("button", { name: /mark handled/i })).toBeTruthy();
	    });
	  });

	  it("suppresses read-only frozen snapshot mutations", async () => {
    const refreshSnapshot = vi.fn().mockResolvedValue({});
    const activeSnapshot = {
      snapshot: {
        readOnly: true,
        snapshot: { id: 88, status: "frozen", updated_at: "2026-05-03T15:00:00.000Z" },
        filters: {
          accounts: [{
            account_id: "gmail-a",
            label: "Work",
            email: "work@example.com",
            color: "#89dceb",
            icon: "Mail",
            count: 1,
          }],
          categories: [],
        },
        carryover: [],
        lanes: {
          needs_attention: [{
            id: 42,
            snapshot_item_id: 42,
            triage_id: 8,
            account_id: "gmail-a",
            email_id: "gmail-a-msg-1",
            uid: "gmail-a-msg-1",
            lane: "needs_attention",
            subject: "Review the lease",
            from_name: "Dana",
            from_address: "dana@example.com",
            summary: "Needs your review.",
            email_date: "2026-05-03T14:00:00.000Z",
            read: false,
          }],
          fyi: [],
          noise: [],
        },
      },
      loading: false,
      error: null,
      refresh: refreshSnapshot,
      sync: vi.fn(),
    };

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] } }}
        setBriefing={() => {}}
        setCalendarDeadlines={() => {}}
      >
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
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={{
            accountId: "__all",
            lane: "__all",
            search: "",
            selectedId: "gmail-a-msg-1",
          }}
          onSessionStateChange={() => {}}
        />
      </DashboardProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Review the lease").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /snooze email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /trash email/i })).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(markSnapshotItemHandled).not.toHaveBeenCalled();
    expect(trashEmail).not.toHaveBeenCalled();
    expect(snoozeEmail).not.toHaveBeenCalled();
    expect(refreshSnapshot).not.toHaveBeenCalled();
  });
});
