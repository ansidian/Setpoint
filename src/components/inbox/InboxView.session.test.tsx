import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ComponentProps } from "react";
import { DashboardProvider } from "../../context/DashboardContext";
import InboxView from "./InboxView";
import type { InboxActiveSnapshotController } from "./InboxView";
import {
  dismissEmail,
  dismissSnapshotItemForToday,
  markSnapshotItemHandled,
  settleArrivalGrace,
  settleArrivalGraceOnExit,
  snoozeEmail,
  trashEmail,
  trashEmailOnExit,
} from "../../api";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures";
import { resetInboxSession } from "./useInboxSessionState";
import type { InboxSessionState } from "./useInboxSessionState";
import type { InboxSelectionId } from "./inboxTypes";

vi.mock("../../api", async () => {
  const actual = await vi.importActual("../../api");
  return {
    ...actual,
    getEmailBody: vi.fn().mockResolvedValue({ body: "Loaded email body" }),
    peekEmailBody: vi.fn(() => null),
    markEmailAsRead: vi.fn().mockResolvedValue({}),
    markEmailAsUnread: vi.fn().mockResolvedValue({}),
    trashEmail: vi.fn().mockResolvedValue({}),
    trashEmailOnExit: vi.fn(),
    snoozeEmail: vi.fn().mockResolvedValue({}),
    markAllEmailsAsRead: vi.fn().mockResolvedValue({}),
    dismissEmail: vi.fn().mockResolvedValue({}),
	    dismissSnapshotItemForToday: vi.fn().mockResolvedValue({}),
    markSnapshotItemHandled: vi.fn().mockResolvedValue({}),
    settleArrivalGrace: vi.fn().mockResolvedValue({}),
    settleArrivalGraceOnExit: vi.fn(),
	  };
	});

vi.mock("../bills/BillBadge", () => ({
  default: function BillBadgeMock() {
    return <div data-testid="bill-badge">Bill badge</div>;
  },
}));

vi.mock("./reader/DraftReply", () => ({
  default: function DraftReplyMock() {
    return <div data-testid="draft-reply">Draft reply</div>;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetInboxSession();
});

function openDesktopTriageMenu() {
  fireEvent.click(screen.getByRole("button", { name: /^triage$/i }));
  return screen.getByRole("menu", { name: /triage email/i });
}

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

function makeProviderTrashSnapshot({ refresh = vi.fn() }: { refresh?: InboxActiveSnapshotController["refresh"] } = {}): InboxActiveSnapshotController {
  return {
    snapshot: makeActiveSnapshot({
      lanes: {
        needs_attention: [
          {
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
          },
        ],
        fyi: [],
        noise: [],
      },
    }),
    loading: false,
    error: null,
    refresh,
    sync: vi.fn(),
  };
}

function ProviderTrashInbox({ activeSnapshot, commitPendingUndoSignal }: {
  activeSnapshot: InboxActiveSnapshotController;
  commitPendingUndoSignal?: unknown;
}) {
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
      commitPendingUndoSignal={commitPendingUndoSignal}
    />
  );
}

function renderProviderTrashInbox(props: Partial<ComponentProps<typeof ProviderTrashInbox>> = {}) {
  const activeSnapshot = props.activeSnapshot || makeProviderTrashSnapshot();
  return render(
    <DashboardProvider
      briefing={{ emails: { accounts: [] } }}
      setBriefing={() => {}}
      setCalendarDeadlines={() => {}}
    >
      <ProviderTrashInbox
        activeSnapshot={activeSnapshot}
        commitPendingUndoSignal={props.commitPendingUndoSignal}
      />
    </DashboardProvider>,
  );
}

function InboxSessionHarness({ initialSelectedId = null, activeSnapshotRefresh = vi.fn() }: {
  initialSelectedId?: InboxSelectionId;
  activeSnapshotRefresh?: InboxActiveSnapshotController["refresh"];
}) {
  const [showInbox, setShowInbox] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [seedSelectedId, setSeedSelectedId] = useState<InboxSelectionId>(null);
  const [snapshot, setSnapshot] = useState(() => makeSessionSnapshot(true));
  const [sessionState, setSessionState] = useState<InboxSessionState>({
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
    refresh: activeSnapshotRefresh,
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
      <button type="button" onClick={() => setCalendarOpen(true)}>
        Open calendar modal
      </button>
      {calendarOpen && <div data-testid="calendar-modal-placeholder">Calendar modal</div>}
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

  it("settles arrival-grace rows on Inbox exit without blocking navigation", async () => {
    vi.mocked(settleArrivalGrace).mockImplementationOnce(() => new Promise(() => {}));
    render(<InboxSessionHarness />);

    fireEvent.click(screen.getByText("Project budget sign-off"));
    expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();
    expect(settleArrivalGrace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to inbox" }));
    expect(screen.getByTestId("inbox-mobile-list")).toBeTruthy();
    expect(settleArrivalGrace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox mount" }));

    expect(screen.getByTestId("dashboard-placeholder")).toBeTruthy();
    expect(settleArrivalGrace).toHaveBeenCalledTimes(1);
  });

  it("refreshes the active snapshot after Inbox exit but not while a calendar modal is open", async () => {
    const activeSnapshotRefresh = vi.fn().mockResolvedValue({});
    render(<InboxSessionHarness activeSnapshotRefresh={activeSnapshotRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: "Open calendar modal" }));
    expect(screen.getByTestId("calendar-modal-placeholder")).toBeTruthy();
    expect(settleArrivalGrace).not.toHaveBeenCalled();
    expect(activeSnapshotRefresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox mount" }));

    expect(screen.getByTestId("dashboard-placeholder")).toBeTruthy();
    expect(settleArrivalGrace).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(activeSnapshotRefresh).toHaveBeenCalledTimes(1));
  });

  it("uses a keepalive settle attempt on page exit", () => {
    render(<InboxSessionHarness />);

    window.dispatchEvent(new Event("pagehide"));

    expect(settleArrivalGraceOnExit).toHaveBeenCalledTimes(1);
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
    vi.useFakeTimers();
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

    fireEvent.click(screen.getByRole("button", { name: /trash email/i }));

    expect(screen.getByRole("button", { name: /^undo$/i })).toBeTruthy();
    expect(screen.getByText("Email moved to trash")).toBeTruthy();
    expect(trashEmail).not.toHaveBeenCalled();
    expect(dismissEmail).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(6_000);
      await Promise.resolve();
    });

    expect(trashEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(dismissEmail).not.toHaveBeenCalled();
  });

  it("commits pending provider trash when leaving the inbox before undo expires", async () => {
    vi.useFakeTimers();
    const refreshSnapshot = vi.fn().mockResolvedValue({});
    const { unmount } = renderProviderTrashInbox({
      activeSnapshot: makeProviderTrashSnapshot({ refresh: refreshSnapshot }),
    });

    fireEvent.click(screen.getByRole("button", { name: /trash email/i }));
    expect(trashEmail).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(trashEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(refreshSnapshot).toHaveBeenCalled();
  });

  it("uses keepalive provider trash when the page exits before undo expires", async () => {
    vi.useFakeTimers();
    renderProviderTrashInbox();

    fireEvent.click(screen.getByRole("button", { name: /trash email/i }));
    window.dispatchEvent(new Event("pagehide"));

    expect(trashEmailOnExit).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(trashEmail).not.toHaveBeenCalled();
  });

  it("commits pending provider trash when an intentional departure signal fires", async () => {
    vi.useFakeTimers();
    const activeSnapshot = makeProviderTrashSnapshot();

    function DepartureHarness() {
      const [departureSignal, setDepartureSignal] = useState(0);
      return (
        <DashboardProvider
          briefing={{ emails: { accounts: [] } }}
          setBriefing={() => {}}
          setCalendarDeadlines={() => {}}
        >
          <button type="button" onClick={() => setDepartureSignal((value) => value + 1)}>
            Open calendar
          </button>
          <ProviderTrashInbox
            activeSnapshot={activeSnapshot}
            commitPendingUndoSignal={departureSignal}
          />
        </DashboardProvider>
      );
    }

    render(<DepartureHarness />);

    fireEvent.click(screen.getByRole("button", { name: /trash email/i }));
    fireEvent.click(screen.getByRole("button", { name: /open calendar/i }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(trashEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(screen.queryByRole("button", { name: /^undo$/i })).toBeNull();
  });

  it("cancels delayed provider trash when undo is clicked", async () => {
    vi.useFakeTimers();
    const refreshSnapshot = vi.fn().mockResolvedValue({});
    const activeSnapshot = {
      snapshot: makeActiveSnapshot({
        lanes: {
          needs_attention: [
            {
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
            },
          ],
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

    fireEvent.click(screen.getByRole("button", { name: /trash email/i }));
    fireEvent.click(screen.getByRole("button", { name: /^undo$/i }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: /^undo$/i })).toBeNull();
    expect(screen.getAllByText("Review the lease").length).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(6_000);
      await Promise.resolve();
    });

    expect(trashEmail).not.toHaveBeenCalled();
    expect(refreshSnapshot).not.toHaveBeenCalled();
  });

  it("triggers inbox undo with Cmd+Z but not while search is focused", async () => {
    vi.useFakeTimers();
    const activeSnapshot = {
      snapshot: makeActiveSnapshot({
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

    fireEvent.click(screen.getByRole("button", { name: /trash email/i }));
    const searchInput = screen.getByLabelText("Search indexed mail");
    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "z", metaKey: true });
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeTruthy();

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: /^undo$/i })).toBeNull();
    expect(trashEmail).not.toHaveBeenCalled();
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

  it("dispatches one desktop snapshot hotkey while preserving shell number keys", async () => {
    const activeSnapshot = {
      snapshot: makeActiveSnapshot({
        lanes: {
          needs_attention: [
            {
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
              read: true,
            },
            {
              id: 43,
              snapshot_item_id: 43,
              triage_id: 9,
              account_id: "gmail-a",
              email_id: "gmail-a-msg-2",
              uid: "gmail-a-msg-2",
              lane: "needs_attention",
              subject: "Second lease note",
              from_name: "Riley",
              from_address: "riley@example.com",
              summary: "Follow-up context.",
              email_date: "2026-05-03T13:00:00.000Z",
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
      sync: vi.fn(),
    };

    function DesktopHotkeyHarness() {
      const [sessionState, setSessionState] = useState<InboxSessionState>({
        accountId: "__all",
        lane: "__all",
        search: "",
        selectedId: "gmail-a-msg-1",
      });

      return (
        <DashboardProvider
          briefing={{ emails: { accounts: [] } }}
          setBriefing={() => {}}
          setCalendarDeadlines={() => {}}
        >
          <div data-testid="selected-id">{sessionState.selectedId}</div>
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
        </DashboardProvider>
      );
    }

    render(<DesktopHotkeyHarness />);

    // A shell number key is not an inbox action: it triggers no snapshot
    // mutation and leaves the selection where it was (observable outcome rather
    // than asserting the internal preventDefault decision).
    fireEvent.keyDown(window, { key: "1" });
    expect(markSnapshotItemHandled).not.toHaveBeenCalled();
    expect(screen.getByTestId("selected-id").textContent).toBe("gmail-a-msg-1");

    fireEvent.keyDown(window, { key: "h" });

    expect(markSnapshotItemHandled).toHaveBeenCalledWith(42);
    await waitFor(() => {
      expect(screen.getByTestId("selected-id").textContent).toBe("gmail-a-msg-2");
    });
  });

  it("suspends desktop action hotkeys while typing or while a floating inbox menu has focus", async () => {
    const activeSnapshot = {
      snapshot: makeActiveSnapshot({
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
            read: true,
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

    const searchInput = screen.getByLabelText("Search indexed mail");
    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "d" });
    expect(dismissSnapshotItemForToday).not.toHaveBeenCalled();

    searchInput.blur();
    const menu = openDesktopTriageMenu();
    const menuButton = menu.querySelector("button");
    expect(menuButton).toBeTruthy();
    menuButton?.focus();

    fireEvent.keyDown(window, { key: "e" });
    expect(trashEmail).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^undo$/i })).toBeNull();
  });

	  it("suppresses read-only frozen snapshot mutations", async () => {
    vi.useFakeTimers();
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

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    expect(screen.getAllByText("Review the lease").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /snooze email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /trash email/i })).toBeNull();

    // Advance fake time across the read-only suppression window instead of a real
    // 650ms wall-clock sleep, so this stays deterministic under full-suite fork load.
    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
    });

    expect(markSnapshotItemHandled).not.toHaveBeenCalled();
    expect(trashEmail).not.toHaveBeenCalled();
    expect(snoozeEmail).not.toHaveBeenCalled();
    expect(refreshSnapshot).not.toHaveBeenCalled();
  });
});
