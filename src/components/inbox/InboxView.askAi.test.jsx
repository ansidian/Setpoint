import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function aiResponse({ uid, subject, answer }) {
  return {
    answer_status: "ok",
    answer: {
      answer,
      confidence: "high",
      cited_source_uids: [uid],
      missing_info: [],
      low_confidence_reason: "",
    },
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

describe("desktop inbox Ask AI flow", () => {
  it("requires Cmd+Enter intent and Enter confirmation before calling Ask AI", async () => {
    askInboxAiSearch.mockResolvedValueOnce(aiResponse({
      uid: "source-1",
      subject: "Amazon return reminder",
      answer: "The return deadline is May 12.",
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
      expect(screen.getByText("The return deadline is May 12.")).toBeTruthy();
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
        answer: "Second answer wins.",
      }));
    });
    await waitFor(() => {
      expect(screen.getByText("Second answer wins.")).toBeTruthy();
    });

    await act(async () => {
      first.resolve(aiResponse({
        uid: "source-1",
        subject: "First source",
        answer: "First answer should be stale.",
      }));
    });

    expect(screen.getByText("Second answer wins.")).toBeTruthy();
    expect(screen.queryByText("First answer should be stale.")).toBeNull();
    expect(screen.queryByText("First source")).toBeNull();
  });
});
