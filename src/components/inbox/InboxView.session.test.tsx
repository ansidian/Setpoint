import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DashboardProvider } from "../../context/DashboardContext";
import InboxView from "./InboxView";
import type { InboxActiveSnapshotController } from "./InboxView";
import {
  settleArrivalGrace,
} from "../../api";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures";
import { resetInboxSession } from "./useInboxSessionState";
import type { InboxSessionState } from "./useInboxSessionState";
import type { InboxSelectionId } from "./inboxTypes";

// test-architecture: allow-boundary-mock -- rendered Inbox session workflows keep the real controller, reader, and undo lifecycle while controlling authenticated HTTP outcomes.
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetInboxSession();
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

  it("refreshes the active snapshot after Inbox exit but not while a calendar modal is open", async () => {
    const activeSnapshotRefresh = vi.fn().mockResolvedValue({});
    render(<InboxSessionHarness activeSnapshotRefresh={activeSnapshotRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: "Open calendar modal" }));
    expect(screen.getByTestId("calendar-modal-placeholder")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox mount" }));

    expect(screen.getByTestId("dashboard-placeholder")).toBeTruthy();
    // test-architecture: allow-boundary-interaction -- hiding Inbox must flush arrival-grace work through the authenticated API; no DOM state exposes that exit-side provider write.
    expect(settleArrivalGrace).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Inbox exit reconciliation crosses the authenticated HTTP boundary; no retained DOM state exposes the required refresh admission.
    await waitFor(() => expect(activeSnapshotRefresh.mock.calls.length).toBe(1));
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

  });
});
