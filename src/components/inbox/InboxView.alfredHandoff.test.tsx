import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext";
import InboxView from "./InboxView";
import type { InboxViewProps } from "./InboxView";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures";
import { resetInboxSession } from "./useInboxSessionState";

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
    searchEmails: vi.fn().mockResolvedValue({ accounts: [], results: [] }),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetInboxSession();
});

function renderDesktopInbox({ onAskAlfred }: Pick<InboxViewProps, "onAskAlfred">) {
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
        onAskAlfred={onAskAlfred}
      />
    </DashboardProvider>,
  );
}

describe("inbox alfred handoff", () => {
  it("hands off to alfred on cmd+enter in the search input", () => {
    const onAskAlfred = vi.fn();
    renderDesktopInbox({ onAskAlfred });
    const input = screen.getByLabelText("Search indexed mail");
    fireEvent.change(input, { target: { value: "car insurance renewal" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onAskAlfred).toHaveBeenCalledWith("car insurance renewal");
  });

  it("renders no ask-ai confirmation ui after the handoff", () => {
    const onAskAlfred = vi.fn();
    renderDesktopInbox({ onAskAlfred });
    const input = screen.getByLabelText("Search indexed mail");
    fireEvent.change(input, { target: { value: "anything" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(screen.queryByTestId("inbox-ai-confirmation")).toBeNull();
    expect(screen.queryByText(/Ask AI/i)).toBeNull();
  });
});
