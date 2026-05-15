import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import { askInboxAiSearch, searchEmails } from "../../api";
import InboxView from "./InboxView.jsx";
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
    searchEmails: vi.fn().mockResolvedValue({ accounts: [], results: [] }),
    askInboxAiSearch: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function aiResponse({ uid, subject }) {
  return {
    answer_status: "ok",
    answer: null,
    retrieval: {
      mode: "hybrid",
      vector_status: "ok",
      lexical_status: "ok",
      total_candidates: 1,
    },
    sources: [{
      uid,
      sender: "Inbox Source <source@example.com>",
      subject,
      date: "2026-05-08T15:00:00.000Z",
      snippet: "Grounded source excerpt",
      account: {
        id: "acc-personal",
        label: "Personal",
        email: "me@example.com",
        color: "#cba6da",
      },
    }],
  };
}

function renderDesktopAskAiInbox() {
  const activeSnapshot = {
    snapshot: makeActiveSnapshot({
      filters: {
        accounts: [{
          account_id: "acc-personal",
          label: "Personal",
          email: "me@example.com",
          color: "#cba6da",
          icon: "Mail",
          count: 0,
        }],
        categories: [],
      },
      lanes: { needs_attention: [], fyi: [], noise: [] },
    }),
    loading: false,
    error: null,
    refresh: vi.fn(),
    sync: vi.fn(),
  };

  return render(
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
        briefingGeneratedAt="2026-05-08 10:00:00"
        activeSnapshot={activeSnapshot}
        liveEmails={[]}
        snoozedEntries={[]}
        resurfacedEntries={[]}
        onOpenDashboard={() => {}}
        onRefresh={() => {}}
      />
    </DashboardProvider>,
  );
}

function AskAiSessionHarness() {
  const [showInbox, setShowInbox] = useState(true);
  const [sessionState, setSessionState] = useState({
    accountId: "__all",
    lane: "__all",
    search: "",
    selectedId: null,
  });
  const activeSnapshot = {
    snapshot: makeActiveSnapshot({
      filters: {
        accounts: [{
          account_id: "acc-personal",
          label: "Personal",
          email: "me@example.com",
          color: "#cba6da",
          icon: "Mail",
          count: 0,
        }],
        categories: [],
      },
      lanes: { needs_attention: [], fyi: [], noise: [] },
    }),
    loading: false,
    error: null,
    refresh: vi.fn(),
    sync: vi.fn(),
  };

  return (
    <DashboardProvider
      briefing={{ emails: { accounts: [] } }}
      setBriefing={() => {}}
      setCalendarDeadlines={() => {}}
    >
      <button type="button" onClick={() => setShowInbox((value) => !value)}>
        Toggle inbox
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
          briefingSummary=""
          briefingGeneratedAt="2026-05-08 10:00:00"
          activeSnapshot={activeSnapshot}
          liveEmails={[]}
          snoozedEntries={[]}
          resurfacedEntries={[]}
          onOpenDashboard={() => {}}
          onRefresh={() => {}}
          sessionState={sessionState}
          onSessionStateChange={setSessionState}
        />
      ) : (
        <div data-testid="dashboard-placeholder">Dashboard</div>
      )}
    </DashboardProvider>
  );
}

describe("desktop inbox Ask AI flow", () => {
  it("requires Cmd+Enter intent and Enter confirmation before calling Ask AI", async () => {
    askInboxAiSearch.mockResolvedValueOnce(aiResponse({
      uid: "source-1",
      subject: "Amazon return reminder",
    }));

    renderDesktopAskAiInbox();
    const input = screen.getByLabelText("Search indexed mail");

    fireEvent.change(input, { target: { value: "amazon return" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(askInboxAiSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(screen.getByTestId("inbox-ai-confirmation")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(askInboxAiSearch).toHaveBeenCalledWith("amazon return");

    await waitFor(() => {
      expect(screen.getByText("Semantic + indexed mail · 1 candidate")).toBeTruthy();
    });
    expect(screen.getByText("Amazon return reminder")).toBeTruthy();
    await waitFor(() => {
      expect(searchEmails).toHaveBeenCalledWith("amazon return");
    });
  });

  it("ignores stale Ask AI responses after a newer confirmed query", async () => {
    const first = deferred();
    const second = deferred();
    askInboxAiSearch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    renderDesktopAskAiInbox();
    const input = screen.getByLabelText("Search indexed mail");

    fireEvent.change(input, { target: { value: "first query" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.change(input, { target: { value: "second query" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      second.resolve(aiResponse({
        uid: "source-2",
        subject: "Second source",
      }));
    });
    await waitFor(() => {
      expect(screen.getByText("Second source")).toBeTruthy();
    });

    await act(async () => {
      first.resolve(aiResponse({
        uid: "source-1",
        subject: "First source",
      }));
    });

    expect(screen.getByText("Second source")).toBeTruthy();
    expect(screen.queryByText("First source")).toBeNull();
  });

  it("preserves completed Ask AI results across inbox unmounts without rerunning semantic search", async () => {
    askInboxAiSearch.mockResolvedValueOnce(aiResponse({
      uid: "source-1",
      subject: "Amazon return reminder",
    }));

    render(<AskAiSessionHarness />);
    const input = screen.getByLabelText("Search indexed mail");

    fireEvent.change(input, { target: { value: "amazon return" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Semantic + indexed mail · 1 candidate")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));
    expect(screen.getByTestId("dashboard-placeholder")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));

    expect(await screen.findByText("Semantic + indexed mail · 1 candidate")).toBeTruthy();
    expect(screen.getByText("Amazon return reminder")).toBeTruthy();
    expect(askInboxAiSearch).toHaveBeenCalledTimes(1);
  });

  it("preserves in-flight Ask AI results when inbox unmounts before the response returns", async () => {
    const request = deferred();
    askInboxAiSearch.mockReturnValueOnce(request.promise);

    render(<AskAiSessionHarness />);
    const input = screen.getByLabelText("Search indexed mail");

    fireEvent.change(input, { target: { value: "amazon return" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Asking AI over indexed mail")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));
    expect(screen.getByTestId("dashboard-placeholder")).toBeTruthy();

    await act(async () => {
      request.resolve(aiResponse({
        uid: "source-1",
        subject: "Amazon return reminder",
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));

    expect(await screen.findByText("Semantic + indexed mail · 1 candidate")).toBeTruthy();
    expect(screen.getByText("Amazon return reminder")).toBeTruthy();
    expect(askInboxAiSearch).toHaveBeenCalledTimes(1);
  });
});
