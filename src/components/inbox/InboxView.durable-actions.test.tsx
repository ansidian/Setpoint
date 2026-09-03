import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DashboardProvider } from "../../context/DashboardContext";
import InboxView from "./InboxView";
import type { InboxActiveSnapshotController, InboxViewProps } from "./InboxView";
import * as api from "../../api";
import type * as Api from "../../api";
import type { EmailSearchClientResponse } from "../../../shared/types/email";
import {
  makeActiveSnapshot,
  makeInboxAccounts,
  makeLiveInboxEmail,
} from "./test-utils/inboxFixtures";
import { resetInboxSession } from "./useInboxSessionState";
import { openMobileEmailActions, openMobileInboxSearch } from "./test-utils/mobileInboxActions.test-utils";
import useDashboardShellHotkeys from "../dashboard/useDashboardShellHotkeys";

// test-architecture: allow-boundary-mock -- these rendered Inbox workflows keep the real controller, rows, reader, optimistic state, and undo lifecycle together while replacing only the authenticated HTTP boundary.
vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof Api>("../../api");
  return {
    ...actual,
    getActiveSnapshot: vi.fn().mockResolvedValue(null),
    getEmailBody: vi.fn().mockResolvedValue({ body: "Loaded email body" }),
    peekEmailBody: vi.fn(() => null),
    markEmailAsRead: vi.fn().mockResolvedValue({}),
    markEmailAsUnread: vi.fn().mockResolvedValue({}),
    markAllEmailsAsRead: vi.fn().mockResolvedValue({}),
    trashEmail: vi.fn().mockResolvedValue({}),
    trashEmailOnExit: vi.fn(),
    snoozeEmail: vi.fn().mockResolvedValue({}),
    unsnoozeEmail: vi.fn().mockResolvedValue({}),
    moveSnapshotItemLane: vi.fn().mockResolvedValue({}),
    dismissSnapshotItemForToday: vi.fn().mockResolvedValue({}),
    restoreSnapshotItemForToday: vi.fn().mockResolvedValue({}),
    markSnapshotItemHandled: vi.fn().mockResolvedValue({}),
    reopenSnapshotItem: vi.fn().mockResolvedValue({}),
    pinEmail: vi.fn().mockResolvedValue({}),
    unpinEmail: vi.fn().mockResolvedValue({}),
    settleArrivalGrace: vi.fn().mockResolvedValue({}),
    settleArrivalGraceOnExit: vi.fn(),
    searchEmails: vi.fn().mockResolvedValue({ accounts: [], results: [] }),
  };
});

function makeSnapshotController(
  snapshot = makeActiveSnapshot(),
): InboxActiveSnapshotController {
  return {
    snapshot,
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue({}),
    sync: vi.fn().mockResolvedValue({}),
  };
}

interface RenderInboxOptions extends Omit<Partial<InboxViewProps>, "customize"> {
  customize?: Record<string, unknown>;
}

function inboxTree(options: RenderInboxOptions) {
  const {
    activeSnapshot,
    emailAccounts = makeInboxAccounts(),
    liveEmails = [],
    isMobile = true,
    ...rest
  } = options;
  return (
    <DashboardProvider briefing={{ emails: { accounts: [] } }} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <InboxView
        accent="#cba6da"
        emailAccounts={emailAccounts}
        liveEmails={liveEmails}
        snoozedEntries={[]}
        resurfacedEntries={[]}
        activeSnapshot={activeSnapshot}
        onRefresh={() => {}}
        isMobile={isMobile}
        {...rest}
      />
    </DashboardProvider>
  );
}

function renderInbox(options: RenderInboxOptions = {}) {
  const rendered = render(inboxTree(options));
  return {
    ...rendered,
    rerenderInbox(next: RenderInboxOptions) {
      rendered.rerender(inboxTree({ ...options, ...next }));
    },
  };
}

async function openActions(subject: string) {
  fireEvent.click(await screen.findByText(subject));
  openMobileEmailActions();
  return screen.getByRole("dialog", { name: "Email actions" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetInboxSession();
  window.history.replaceState(null, "", "/");
});

describe("InboxView durable trash workflows", () => {
  it("commits a live trash after the undo window is finalized and refreshes provider state", async () => {
    const view = renderInbox({ liveEmails: [makeLiveInboxEmail({ uid: "live-commit" })], commitPendingUndoSignal: 0 });

    fireEvent.click(await screen.findByText("Fresh live ping"));
    fireEvent.click(openMobileEmailActions().getByRole("button", { name: "Trash" }));
    // test-architecture: allow-boundary-interaction -- Active-snapshot refresh is an authenticated HTTP boundary; the pre-commit count distinguishes the one required reconciliation after the provider write.
    const beforeCommitRefreshes = vi.mocked(api.getActiveSnapshot).mock.calls.length;
    view.rerenderInbox({ commitPendingUndoSignal: 1 });

    // test-architecture: allow-boundary-interaction -- the provider trash call and subsequent snapshot refresh are the durable boundary outcome of the rendered deferred action.
    await waitFor(() => expect(api.trashEmail).toHaveBeenCalledWith("live-commit"));
    // test-architecture: allow-boundary-interaction -- committing live trash reconciles the active snapshot exactly once after the provider write.
    await waitFor(() => expect(api.getActiveSnapshot).toHaveBeenCalledTimes(beforeCommitRefreshes + 1));
  });

  it("uses the exit-safe trash boundary when the page leaves during the undo window", async () => {
    renderInbox({ liveEmails: [makeLiveInboxEmail({ uid: "live-exit" })] });

    fireEvent.click(await screen.findByText("Fresh live ping"));
    fireEvent.click(openMobileEmailActions().getByRole("button", { name: "Trash" }));
    act(() => window.dispatchEvent(new Event("pagehide")));

    // test-architecture: allow-boundary-interaction -- page exit must use the sendBeacon-compatible provider boundary instead of the ordinary async commit.
    expect(api.trashEmailOnExit).toHaveBeenCalledWith("live-exit");
    // test-architecture: allow-boundary-interaction -- exit-safe trash must not duplicate the same provider write through the ordinary async endpoint.
    expect(api.trashEmail).not.toHaveBeenCalled();
  });

  it("commits active-snapshot trash and refreshes the durable snapshot", async () => {
    const controller = makeSnapshotController();
    const view = renderInbox({ activeSnapshot: controller, commitPendingUndoSignal: 0 });

    fireEvent.click(screen.getByText("Snapshot action"));
    fireEvent.click(openMobileEmailActions().getByRole("button", { name: "Trash" }));
    view.rerenderInbox({ commitPendingUndoSignal: 1 });

    // test-architecture: allow-boundary-interaction -- snapshot trash must commit the provider UID and reconcile the durable snapshot.
    await waitFor(() => expect(api.trashEmail).toHaveBeenCalledWith("snapshot-msg-1"));
    // test-architecture: allow-boundary-interaction -- the snapshot controller refresh is the durable reconciliation boundary after trash.
    await waitFor(() => expect(controller.refresh).toHaveBeenCalled());
  });

  it("commits an indexed result without refreshing the active snapshot", async () => {
    const controller = makeSnapshotController();
    vi.mocked(api.searchEmails).mockResolvedValueOnce({
      accounts: [],
      results: [{
        uid: "indexed-trash",
        from_name: "Dana",
        from_address: "dana@example.com",
        subject: "Indexed trash result",
        body_snippet: "Search preview",
        subject_highlight: null,
        body_highlight: null,
        email_date: "2026-05-03T14:00:00.000Z",
        read: false,
        web_url: null,
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#89dceb",
        account_icon: "Mail",
      }],
      total: 1,
      offset: 0,
      has_more: false,
      capped: false,
      query: "indexed",
    } satisfies EmailSearchClientResponse);
    const view = renderInbox({ activeSnapshot: controller, commitPendingUndoSignal: 0 });
    fireEvent.change(openMobileInboxSearch(), { target: { value: "indexed" } });

    fireEvent.click(await screen.findByText("Indexed trash result"));
    fireEvent.click(openMobileEmailActions().getByRole("button", { name: "Trash" }));
    view.rerenderInbox({ commitPendingUndoSignal: 1 });

    // test-architecture: allow-boundary-interaction -- indexed/briefing trash commits the provider UID without snapshot reconciliation.
    await waitFor(() => expect(api.trashEmail).toHaveBeenCalledWith("indexed-trash"));
    // test-architecture: allow-boundary-interaction -- indexed trash intentionally leaves the unrelated active-snapshot persistence boundary untouched.
    expect(controller.refresh).not.toHaveBeenCalled();
  });
});

describe("InboxView snapshot mutation recovery", () => {
  it("claims the A lane hotkey without also opening shell Analytics", async () => {
    const initial = makeActiveSnapshot();
    const actionRow = initial.lanes!.needs_attention![0]!;
    const controller = makeSnapshotController(makeActiveSnapshot({
      lanes: {
        needs_attention: [],
        fyi: [{ ...actionRow, lane: "fyi" }],
        noise: [],
      },
    }));

    function Harness() {
      const [analyticsOpen, setAnalyticsOpen] = useState(false);
      const [, setHistoryOpen] = useState(false);
      useDashboardShellHotkeys({
        isMobile: false,
        analyticsOpen,
        openPalette: () => {},
        openAnalytics: () => setAnalyticsOpen(true),
        closeAnalytics: () => setAnalyticsOpen(false),
        openDeadlineCreate: () => {},
        openCalendar: () => {},
        setHistoryOpen,
        toggleAlfred: () => {},
        alfredNewChat: () => {},
        activeTab: "inbox",
      });
      return (
        <>
          <output>{analyticsOpen ? "Analytics open" : "Analytics closed"}</output>
          {inboxTree({ activeSnapshot: controller, isMobile: false })}
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByText("Snapshot action"));
    fireEvent.keyDown(window, { key: "a", cancelable: true });

    // test-architecture: allow-boundary-interaction -- the hotkey's lane move is the owner-visible provider mutation contract.
    await waitFor(() => expect(api.moveSnapshotItemLane).toHaveBeenCalledWith(11, "needs_attention"));
    expect(screen.getByText("Analytics closed")).toBeTruthy();
  });

  it("moves a snapshot row and restores its prior lane through Undo", async () => {
    const controller = makeSnapshotController();
    renderInbox({ activeSnapshot: controller });
    fireEvent.click(screen.getByText("Snapshot action"));
    fireEvent.click(openMobileEmailActions().getByRole("button", { name: "Move to FYI" }));

    // test-architecture: allow-boundary-interaction -- the lane payload is the durable snapshot mutation contract.
    await waitFor(() => expect(api.moveSnapshotItemLane).toHaveBeenCalledWith(11, "fyi"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // test-architecture: allow-boundary-interaction -- Undo must reverse the durable lane mutation to its prior owner-visible state.
    await waitFor(() => expect(api.moveSnapshotItemLane).toHaveBeenLastCalledWith(11, "needs_attention"));
  });

  it("rolls a failed dismissal back, refreshes, and releases the row for retry", async () => {
    const controller = makeSnapshotController();
    vi.mocked(api.dismissSnapshotItemForToday)
      .mockRejectedValueOnce(new Error("dismiss failed"))
      .mockResolvedValueOnce({} as never);
    renderInbox({ activeSnapshot: controller });

    let actions = await openActions("Snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.getByText("Snapshot action")).toBeTruthy());
    // test-architecture: allow-boundary-interaction -- a rejected dismissal refreshes provider truth before the row becomes retryable.
    await waitFor(() => expect(controller.refresh).toHaveBeenCalled());

    actions = await openActions("Snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Dismiss" }));
    // test-architecture: allow-boundary-interaction -- retrying after rollback proves the pending lock was released at the provider boundary.
    await waitFor(() => expect(api.dismissSnapshotItemForToday).toHaveBeenCalledTimes(2));
  });

  it("restores a successfully dismissed snapshot row through Undo", async () => {
    renderInbox({ activeSnapshot: makeSnapshotController() });

    const actions = await openActions("Snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Dismiss" }));
    // test-architecture: allow-boundary-interaction -- Dismiss and Undo must produce a reversible pair of durable snapshot mutations.
    await waitFor(() => expect(api.dismissSnapshotItemForToday).toHaveBeenCalledWith(11));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // test-architecture: allow-boundary-interaction -- Undo restores the exact dismissed snapshot item at the provider boundary.
    await waitFor(() => expect(api.restoreSnapshotItemForToday).toHaveBeenCalledWith(11));
    expect(await screen.findByText("Snapshot action")).toBeTruthy();
  });

  it("reopens a handled snapshot row and restores handled state through Undo", async () => {
    const handled = {
      ...makeActiveSnapshot().lanes!.needs_attention![0]!,
      lane: "handled",
      handled_at: "2026-05-03T15:05:00.000Z",
      previous_lane: "needs_attention",
      subject: "Handled snapshot action",
    };
    const snapshot = makeActiveSnapshot({
      lanes: { needs_attention: [], fyi: [], noise: [], handled: [handled] },
    });
    renderInbox({ activeSnapshot: makeSnapshotController(snapshot) });

    const actions = await openActions("Handled snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Reopen" }));
    // test-architecture: allow-boundary-interaction -- Reopen mutates the durable handled item through the snapshot provider boundary.
    await waitFor(() => expect(api.reopenSnapshotItem).toHaveBeenCalledWith(11));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // test-architecture: allow-boundary-interaction -- Undo re-applies handled state to the same snapshot item.
    await waitFor(() => expect(api.markSnapshotItemHandled).toHaveBeenCalledWith(11));
  });

  it("unpins a rendered pinned row and restores it through Undo", async () => {
    const snapshot = makeActiveSnapshot({
      pinned: [{
        uid: "pinned-msg-1",
        pinned_at: "2026-05-03T14:00:00.000Z",
        account_id: "gmail-work",
        subject: "Pinned snapshot action",
        from_name: "Dana",
        from_address: "dana@example.com",
        preview: "Pinned preview",
        date: "2026-05-03T15:00:00.000Z",
        read: false,
      }],
    });
    renderInbox({ activeSnapshot: makeSnapshotController(snapshot) });

    const actions = await openActions("Pinned snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Unpin" }));
    // test-architecture: allow-boundary-interaction -- Unpin removes the explicit durable pinned overlay for the rendered row.
    await waitFor(() => expect(api.unpinEmail).toHaveBeenCalledWith("pinned-msg-1"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // test-architecture: allow-boundary-interaction -- Undo recreates the provider pin with its captured email snapshot.
    await waitFor(() => expect(api.pinEmail).toHaveBeenCalledWith("pinned-msg-1", expect.any(Object)));
  });

  it("rolls back failed snooze and failed pin projections", async () => {
    vi.mocked(api.snoozeEmail).mockRejectedValueOnce(new Error("snooze failed"));
    const controller = makeSnapshotController();
    renderInbox({ activeSnapshot: controller });
    fireEvent.click(screen.getByText("Snapshot action"));
    fireEvent.click(openMobileEmailActions().getByRole("button", { name: "Snooze" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Snooze" })).getByRole("menuitem", { name: /^6 hours/ }));
    await waitFor(() => expect(screen.getByText("Snapshot action")).toBeTruthy());

    vi.mocked(api.pinEmail).mockRejectedValueOnce(new Error("pin failed"));
    const actions = await openActions("Snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(screen.getByText("Snapshot action")).toBeTruthy());
    fireEvent.click(screen.getByText("Snapshot action"));
    openMobileEmailActions();
    expect(within(screen.getByRole("dialog", { name: "Email actions" })).getByRole("button", { name: "Pin" })).toBeTruthy();
  });

  it("rolls a failed mark-read projection back to unread", async () => {
    vi.mocked(api.markEmailAsRead).mockRejectedValueOnce(new Error("mark read failed"));
    renderInbox({ activeSnapshot: makeSnapshotController() });
    let actions = await openActions("Snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Mark read" }));

    // test-architecture: allow-boundary-interaction -- the rejected provider write is the failure boundary whose optimistic read state must roll back.
    await waitFor(() => expect(api.markEmailAsRead).toHaveBeenCalledWith("snapshot-msg-1"));
    openMobileEmailActions();
    actions = screen.getByRole("dialog", { name: "Email actions" });
    expect(within(actions).getByRole("button", { name: "Mark read" })).toBeTruthy();
  });

  it("hides frozen snapshot pins while still allowing an explicit pin action", async () => {
    const snapshot = makeActiveSnapshot({
      readOnly: true,
      pinned: [{
        uid: "snapshot-msg-1",
        pinned_at: "2026-05-03T14:00:00.000Z",
        account_id: "gmail-work",
        subject: "Snapshot action",
        from_name: "Dana",
        from_address: "dana@example.com",
        preview: "Pinned preview",
        date: "2026-05-03T15:00:00.000Z",
        read: false,
      }],
    });
    renderInbox({ activeSnapshot: makeSnapshotController(snapshot) });
    expect(screen.queryByText("Pinned")).toBeNull();

    const actions = await openActions("Snapshot action");
    fireEvent.click(within(actions).getByRole("button", { name: "Pin" }));
    // test-architecture: allow-boundary-interaction -- pinning is an explicit durable overlay write that remains available while the historical snapshot itself is read-only.
    await waitFor(() => expect(api.pinEmail).toHaveBeenCalledWith("snapshot-msg-1", expect.any(Object)));
  });
});
