import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import InboxView from "./InboxView.jsx";

vi.mock("../../api", async () => {
  const actual = await vi.importActual("../../api");
  return {
    ...actual,
    getEmailBody: vi.fn().mockResolvedValue({ body: "Loaded email body" }),
    peekEmailBody: vi.fn(() => null),
    markEmailAsRead: vi.fn().mockResolvedValue({}),
    markEmailAsUnread: vi.fn().mockResolvedValue({}),
    trashEmail: vi.fn().mockResolvedValue({}),
    pinEmail: vi.fn().mockResolvedValue({}),
    unpinEmail: vi.fn().mockResolvedValue({}),
    snoozeEmail: vi.fn().mockResolvedValue({}),
    markAllEmailsAsRead: vi.fn().mockResolvedValue({}),
    dismissEmail: vi.fn().mockResolvedValue({}),
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
});

function makeAccounts(includeAction = true) {
  return [
    {
      id: "acc-work",
      name: "Work",
      email: "work@example.com",
      color: "#89dceb",
      unread: includeAction ? 1 : 0,
      important: includeAction
        ? [
            {
              id: "email-action",
              uid: "email-action",
              subject: "Project budget sign-off",
              from: "Dana",
              fromEmail: "dana@example.com",
              date: "2026-04-19T15:30:00.000Z",
              preview: "Need your approval on the revised budget today.",
              read: false,
            },
          ]
        : [],
      noise: [],
    },
    {
      id: "acc-personal",
      name: "Personal",
      email: "personal@example.com",
      color: "#cba6da",
      unread: 1,
      important: [
        {
          id: "email-fyi",
          uid: "email-fyi",
          subject: "Budget dinner plans",
          from: "Chris",
          fromEmail: "chris@example.com",
          date: "2026-04-19T14:00:00.000Z",
          preview: "Checking whether Sunday still works.",
          read: false,
        },
      ],
      noise: [],
    },
  ];
}

function InboxSessionHarness({ initialSelectedId = null }) {
  const [showInbox, setShowInbox] = useState(true);
  const [seedSelectedId, setSeedSelectedId] = useState(null);
  const [accounts, setAccounts] = useState(() => makeAccounts(true));
  const [sessionState, setSessionState] = useState({
    accountId: "__all",
    lane: "__all",
    search: "",
    selectedId: initialSelectedId,
  });

  const briefing = {
    emails: {
      summary: "Handle the approval first, then everything else can wait.",
      accounts,
    },
  };

  return (
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <button type="button" onClick={() => setShowInbox((prev) => !prev)}>
        Toggle inbox mount
      </button>
      <button type="button" onClick={() => setSeedSelectedId("email-action")}>
        Seed action email
      </button>
      <button type="button" onClick={() => setAccounts(makeAccounts(false))}>
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
          emailAccounts={accounts}
          briefingSummary={briefing.emails.summary}
          briefingGeneratedAt="2026-04-19 15:00:00"
          liveEmails={[]}
          pinnedIds={[]}
          pinnedSnapshots={[]}
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
});
