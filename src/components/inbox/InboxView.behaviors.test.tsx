import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState } from "react";
import { DashboardProvider } from "../../context/DashboardContext";
import InboxView from "./InboxView";
import type { InboxActiveSnapshotController, InboxViewProps } from "./InboxView";
import * as api from "../../api";
import type * as Api from "../../api";
import {
  makeActiveSnapshot,
  makeInboxAccounts,
  makeLiveInboxEmail,
} from "./test-utils/inboxFixtures";
import { resetInboxSession } from "./useInboxSessionState";
import type { EmailSearchClientResponse, EmailSearchResult } from "../../../shared/types/email";

// test-architecture: allow-boundary-mock -- Inbox behavior is rendered with real controllers, rows, readers, and state; the authenticated HTTP/API surface is the only replaced boundary.
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

function makeSearchResult(overrides: Partial<EmailSearchResult>): EmailSearchResult {
  return {
    uid: "search-result",
    from_name: "Sender",
    from_address: "sender@example.com",
    subject: "Search result",
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
    ...overrides,
  };
}

function makeSearchResponse(overrides: Partial<EmailSearchClientResponse>): EmailSearchClientResponse {
  return {
    accounts: [],
    results: [],
    total: 0,
    offset: 0,
    has_more: false,
    capped: false,
    query: "",
    ...overrides,
  };
}

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

const EMPTY_SNOOZED_ENTRIES: NonNullable<InboxViewProps["snoozedEntries"]> = [];
const EMPTY_RESURFACED_ENTRIES: NonNullable<InboxViewProps["resurfacedEntries"]> = [];
const NOOP_READ_OVERRIDE = () => {};

function renderInbox(options: RenderInboxOptions = {}) {
  const {
    activeSnapshot,
    emailAccounts = makeInboxAccounts(),
    liveEmails = [],
    liveReadOverrides = {},
    onLiveReadOverrideChange = NOOP_READ_OVERRIDE,
    snoozedEntries = EMPTY_SNOOZED_ENTRIES,
    resurfacedEntries = EMPTY_RESURFACED_ENTRIES,
    sessionState,
    onSessionStateChange,
    isMobile = true,
    ...rest
  } = options;
  return render(
    <DashboardProvider briefing={{ emails: { accounts: [] } }} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <InboxView
        accent="#cba6da"
        emailAccounts={emailAccounts}
        briefingSummary="Handle the approval first."
        briefingGeneratedAt="2026-05-03 15:00:00"
        liveEmails={liveEmails}
        liveReadOverrides={liveReadOverrides}
        onLiveReadOverrideChange={onLiveReadOverrideChange}
        snoozedEntries={snoozedEntries}
        resurfacedEntries={resurfacedEntries}
        activeSnapshot={activeSnapshot}
        sessionState={sessionState}
        onSessionStateChange={onSessionStateChange}
        onOpenDashboard={() => {}}
        onRefresh={() => {}}
        isMobile={isMobile}
        {...rest}
      />
    </DashboardProvider>,
  );
}

interface RenderInboxOptions extends Omit<Partial<InboxViewProps>, "customize"> {
  customize?: Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetInboxSession();
  window.history.replaceState(null, "", "/");
});

describe("InboxView action workflows", () => {
  it("optimistically removes a live row and restores it through the rendered undo action", async () => {
    renderInbox({ liveEmails: [makeLiveInboxEmail({ uid: "live-trash" })] });

    fireEvent.click(await screen.findByText("Fresh live ping"));
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));

    await waitFor(() => expect(screen.getByTestId("inbox-mobile-list")).toBeTruthy());
    expect(screen.queryByText("Fresh live ping")).toBeNull();

    // test-architecture: allow-boundary-interaction -- the provider commit is deliberately deferred while the user-visible undo window is open.
    expect(api.trashEmail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy());
    expect(screen.getByText("Fresh live ping")).toBeTruthy();
    // test-architecture: allow-boundary-interaction -- undo cancels the outbound provider commit at the API boundary.
    expect(api.trashEmail).not.toHaveBeenCalled();
  });

  it("handles a snapshot row, changes its rendered lane, and reopens it through Undo", async () => {
    renderInbox({ activeSnapshot: makeSnapshotController() });

    fireEvent.click(screen.getByText("Snapshot action"));
    fireEvent.click(screen.getByRole("button", { name: "Handled" }));

    // test-architecture: allow-boundary-interaction -- snapshot-item mutation payload is the outbound API contract for this rendered workflow.
    await waitFor(() => expect(api.markSnapshotItemHandled).toHaveBeenCalledWith(11));
    expect(screen.queryByRole("button", { name: "Handled" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    // test-architecture: allow-boundary-interaction -- Undo restores the snapshot item's provider-owned lifecycle state.
    await waitFor(() => expect(api.reopenSnapshotItem).toHaveBeenCalledWith(11));
    expect(screen.getByRole("button", { name: "Handled" })).toBeTruthy();
  });

  it("snoozes a selected live email with its row snapshot and unsnoozes it from Undo", async () => {
    renderInbox({ liveEmails: [makeLiveInboxEmail({ uid: "live-snooze", subject: "Snooze this email" })] });

    fireEvent.click(await screen.findByText("Snooze this email"));
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    const picker = await screen.findByRole("dialog", { name: "Snooze" });
    fireEvent.click(within(picker).getByRole("menuitem", { name: /^6 hours/ }));

    // test-architecture: allow-boundary-interaction -- snooze timestamp and captured email row are the provider API contract.
    await waitFor(() => expect(api.snoozeEmail).toHaveBeenCalledWith(
      "live-snooze",
      expect.any(Number),
      expect.objectContaining({ uid: "live-snooze", subject: "Snooze this email" }),
    ));
    expect(screen.getByTestId("inbox-mobile-reader")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    // test-architecture: allow-boundary-interaction -- Undo's unsnooze call is the durable provider reconciliation contract.
    await waitFor(() => expect(api.unsnoozeEmail).toHaveBeenCalledWith("live-snooze"));
    expect(await screen.findByText("Snooze this email")).toBeTruthy();
  });

  it("pins a selected row through the reader and undoes the pin at the provider boundary", async () => {
    renderInbox({ activeSnapshot: makeSnapshotController() });

    fireEvent.click(screen.getByText("Snapshot action"));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));

    // test-architecture: allow-boundary-interaction -- pin payload is the user-visible provider write contract.
    await waitFor(() => expect(api.pinEmail).toHaveBeenCalledWith(
      "snapshot-msg-1",
      expect.objectContaining({ uid: "snapshot-msg-1", subject: "Snapshot action" }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("button", { name: "Unpin" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    // test-architecture: allow-boundary-interaction -- Undo reverses the pin through the provider boundary.
    await waitFor(() => expect(api.unpinEmail).toHaveBeenCalledWith("snapshot-msg-1"));
  });

  it("rolls a failed read toggle back through the rendered row and reader state", async () => {
    vi.mocked(api.markEmailAsUnread).mockRejectedValueOnce(new Error("mark-unread failed"));

    const readFailureController = makeSnapshotController(makeActiveSnapshot({
      lanes: {
        needs_attention: [{
          id: 11,
          snapshot_item_id: 11,
          uid: "read-failure",
          email_id: "read-failure",
          account_id: "gmail-work",
          lane: "needs_attention",
          subject: "Read failure row",
          from_name: "Dana",
          from_address: "dana@example.com",
          date: "2026-05-03T15:00:00.000Z",
          read: true,
        }],
        fyi: [],
        noise: [],
      },
    }));

    function ReadHarness() {
      const [readOverrides, setReadOverrides] = useState<Record<string, boolean>>({});
      const onReadOverrideChange = useCallback((uid: string, read: boolean) => {
        setReadOverrides((prev) => ({ ...prev, [uid]: read }));
      }, []);
      return (
        <InboxView
          accent="#cba6da"
          emailAccounts={[]}
          activeSnapshot={readFailureController}
          liveReadOverrides={readOverrides}
          onLiveReadOverrideChange={onReadOverrideChange}
          snoozedEntries={EMPTY_SNOOZED_ENTRIES}
          resurfacedEntries={EMPTY_RESURFACED_ENTRIES}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          isMobile
        />
      );
    }

    render(
      <DashboardProvider briefing={{ emails: { accounts: [] } }} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        <ReadHarness />
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByText("Read failure row"));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark unread" }));

    // test-architecture: allow-boundary-interaction -- the rejected provider mutation is the failure boundary under test.
    await waitFor(() => expect(api.markEmailAsUnread).toHaveBeenCalledWith("read-failure"));
    expect(await screen.findByTestId("inbox-mobile-list")).toBeTruthy();
    expect(screen.getByText("Read failure row")).toBeTruthy();
  });
});

describe("InboxView search workflows", () => {
  it("keeps the newest indexed-search response when an older request resolves late", async () => {
    let resolveFirst: ((value: EmailSearchClientResponse) => void) | undefined;
    let resolveSecond: ((value: EmailSearchClientResponse) => void) | undefined;
    vi.mocked(api.searchEmails)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    renderInbox({ liveEmails: [] });
    const input = await screen.findByLabelText("Search indexed mail");
    fireEvent.change(input, { target: { value: "older" } });

    // test-architecture: allow-boundary-interaction -- indexed search requests are the authenticated HTTP boundary.
    await waitFor(() => expect(api.searchEmails).toHaveBeenNthCalledWith(
      1,
      "older",
      30,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    fireEvent.change(input, { target: { value: "newer" } });
    // test-architecture: allow-boundary-interaction -- the second request is the newer outbound search boundary.
    await waitFor(() => expect(api.searchEmails).toHaveBeenNthCalledWith(
      2,
      "newer",
      30,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    // test-architecture: allow-boundary-interaction -- a superseded HTTP request must be aborted so obsolete indexed work cannot continue consuming the provider boundary.
    const supersededSignal = vi.mocked(api.searchEmails).mock.calls[0]?.[2]?.signal;
    expect(supersededSignal).toBeInstanceOf(AbortSignal);
    expect(supersededSignal!.aborted).toBe(true);

    await act(async () => {
      resolveSecond?.(makeSearchResponse({
        query: "newer",
        results: [makeSearchResult({ uid: "newer-result", subject: "Newest indexed result" })],
        total: 1,
      }));
      await Promise.resolve();
    });
    expect(await screen.findByText("Newest indexed result")).toBeTruthy();

    await act(async () => {
      resolveFirst?.(makeSearchResponse({
        query: "older",
        results: [makeSearchResult({ uid: "older-result", subject: "Stale indexed result" })],
        total: 1,
      }));
      await Promise.resolve();
    });
    expect(screen.getByText("Newest indexed result")).toBeTruthy();
    expect(screen.queryByText("Stale indexed result")).toBeNull();
  });

  it("keeps a local search read toggle when a fresh response reports the old state", async () => {
    vi.mocked(api.searchEmails)
      .mockResolvedValueOnce(makeSearchResponse({
        query: "first",
        results: [makeSearchResult({ uid: "search-read", subject: "Search read state", read: true })],
        total: 1,
      }))
      .mockResolvedValueOnce(makeSearchResponse({
        query: "second",
        results: [makeSearchResult({ uid: "search-read", subject: "Search read state", read: true })],
        total: 1,
      }));

    renderInbox({ liveEmails: [] });
    const input = await screen.findByLabelText("Search indexed mail");
    fireEvent.change(input, { target: { value: "first" } });
    await waitFor(() => expect(screen.getByText("Search read state")).toBeTruthy());

    fireEvent.click(screen.getByText("Search read state"));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark unread" }));
    expect(await screen.findByTestId("inbox-mobile-list")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search indexed mail"), { target: { value: "second" } });
    // test-architecture: allow-boundary-interaction -- the second search request is the HTTP boundary for the fresh-response reconciliation.
    await waitFor(() => expect(api.searchEmails).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText("Search read state"));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("button", { name: "Mark read" })).toBeTruthy();
  });

  it("suppresses short queries and shows a recoverable indexed-search failure", async () => {
    renderInbox({ liveEmails: [] });
    const input = await screen.findByLabelText("Search indexed mail");
    fireEvent.change(input, { target: { value: "x" } });
    // test-architecture: allow-boundary-interaction -- sub-threshold queries must not cross the indexed-search HTTP boundary.
    expect(api.searchEmails).not.toHaveBeenCalled();

    vi.mocked(api.searchEmails).mockRejectedValueOnce(new Error("Indexed search unavailable"));
    fireEvent.change(input, { target: { value: "broken" } });
    expect(await screen.findByText("Indexed search unavailable")).toBeTruthy();
    expect((screen.getByLabelText("Search indexed mail") as HTMLInputElement).value).toBe("broken");
  });

  it("grows indexed results only to 100 and resets the limit for a new term", async () => {
    vi.mocked(api.searchEmails).mockImplementation(async (query, limit) => makeSearchResponse({
      query,
      results: [makeSearchResult({ uid: `${query}-${limit}`, subject: `${query} result ${limit}` })],
      total: 150,
      has_more: true,
    }));
    renderInbox({ liveEmails: [] });
    const input = await screen.findByLabelText("Search indexed mail");
    fireEvent.change(input, { target: { value: "ceiling" } });
    expect(await screen.findByText("ceiling result 30")).toBeTruthy();

    for (const expectedLimit of [60, 90, 100]) {
      fireEvent.click(screen.getByRole("button", { name: "Show more results" }));
      // test-architecture: allow-boundary-interaction -- the growing limit is the paginated HTTP request contract, capped at the product's first-100 boundary.
      await waitFor(() => expect(api.searchEmails).toHaveBeenLastCalledWith(
        "ceiling",
        expectedLimit,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ));
    }
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show more results" })).toBeNull());

    fireEvent.change(input, { target: { value: "fresh" } });
    // test-architecture: allow-boundary-interaction -- a new term restarts the public search contract at the base page size.
    await waitFor(() => expect(api.searchEmails).toHaveBeenLastCalledWith(
      "fresh",
      30,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });
});

describe("InboxView session and projection workflows", () => {
  it("keeps the selected reader across an uncontrolled Inbox unmount and remount", async () => {
    function Harness() {
      const [showInbox, setShowInbox] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShowInbox((visible) => !visible)}>
            Toggle inbox
          </button>
          {showInbox && <InboxView
            accent="#cba6da"
            emailAccounts={makeInboxAccounts()}
            liveEmails={[makeLiveInboxEmail({ uid: "session-live" })]}
            onLiveReadOverrideChange={NOOP_READ_OVERRIDE}
            snoozedEntries={EMPTY_SNOOZED_ENTRIES}
            resurfacedEntries={EMPTY_RESURFACED_ENTRIES}
            onOpenDashboard={() => {}}
            onRefresh={() => {}}
            isMobile
          />}
        </>
      );
    }

    render(
      <DashboardProvider briefing={{ emails: { accounts: [] } }} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        <Harness />
      </DashboardProvider>,
    );

    fireEvent.click(await screen.findByText("Fresh live ping"));
    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));

    expect(await screen.findByTestId("inbox-mobile-reader")).toBeTruthy();
    expect(screen.getByText("Fresh live ping")).toBeTruthy();
  });

  it("renders a pinned snapshot row once even when it is also in a lane", () => {
    renderInbox({
      activeSnapshot: makeSnapshotController(makeActiveSnapshot({
        lanes: {
          needs_attention: [{
            id: 11,
            snapshot_item_id: 11,
            uid: "pinned-snapshot",
            email_id: "pinned-snapshot",
            account_id: "gmail-work",
            lane: "needs_attention",
            subject: "Pinned snapshot row",
            from_name: "Dana",
            from_address: "dana@example.com",
            date: "2026-05-03T15:00:00.000Z",
            read: false,
          }],
          fyi: [],
          noise: [],
        },
        pinned: [{
          uid: "pinned-snapshot",
          pinned_at: "2026-05-03T14:00:00.000Z",
          account_id: "gmail-work",
          subject: "Pinned snapshot row",
          from_name: "Dana",
          from_address: "dana@example.com",
          preview: "Pinned preview",
          date: "2026-05-03T15:00:00.000Z",
          read: false,
          account_label: "Work",
          account_email: "work@example.com",
        }],
      })),
    });

    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getAllByText("Pinned snapshot row")).toHaveLength(1);
  });
});
