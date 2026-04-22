import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function makeAccounts() {
  return [
    {
      id: "acc-work",
      name: "Work",
      email: "work@example.com",
      color: "#89dceb",
      unread: 2,
      important: [
        {
          id: "email-action",
          uid: "email-action",
          subject: "Project budget sign-off",
          from: "Dana",
          fromEmail: "dana@example.com",
          date: "2026-04-19T15:30:00.000Z",
          preview: "Need your approval on the revised budget today.",
          fullBody: "Please approve the revised budget.",
          read: false,
          urgency: "high",
          claude: {
            summary: "Requires a fast approval decision.",
            draftReply: "Approved. Please proceed.",
          },
          hasBill: true,
          extractedBill: {
            payee: "Vendor",
            amount: 125,
            due_date: "2026-04-20",
            type: "expense",
          },
        },
      ],
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
          fullBody: "Sunday dinner still works for me.",
          read: false,
        },
      ],
      noise: [
        {
          id: "email-noise",
          uid: "email-noise",
          subject: "Weekly sale roundup",
          from: "Store",
          fromEmail: "store@example.com",
          date: "2026-04-18T13:00:00.000Z",
          preview: "Discounts you can ignore.",
          fullBody: "This is a marketing email.",
          read: true,
          noise: true,
        },
      ],
    },
  ];
}

function renderInbox({
  isMobile = true,
  seedSelectedId = null,
  customize = {},
  liveEmails = [
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
      read: false,
    },
  ],
} = {}) {
  const briefing = {
    emails: {
      summary: "Handle the approval first, then everything else can wait.",
      accounts: makeAccounts(),
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
        pinnedIds={[]}
        pinnedSnapshots={[]}
        snoozedEntries={[]}
        resurfacedEntries={[]}
        onOpenDashboard={() => {}}
        onRefresh={() => {}}
        seedSelectedId={seedSelectedId}
        isMobile={isMobile}
      />
    </DashboardProvider>,
  );
}

describe("InboxView mobile", () => {
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
});
