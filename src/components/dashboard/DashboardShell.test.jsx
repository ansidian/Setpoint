import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardShell } from "./DashboardShell.jsx";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import useIsMobile from "../../hooks/useIsMobile";

// This file isolates the tabpanel<->tab ARIA linkage added by A11Y-05. Every
// heavy child (lazy tab content, calendar workspace state, alfred, overlays) is
// stubbed so the only thing under test is DashboardShell's own JSX: each
// KeepAliveTab's thin `role="tabpanel"` wrapper (see KeepAliveTab.jsx for why a
// wrapper element was needed — Activity/FrozenWhenHidden render no DOM node of
// their own) and ShellTabs' tab semantics wiring them together via
// id="shell-tab-{key}" / aria-labelledby (desktop) or aria-label (mobile, where
// ShellTabs — and thus the ids it would link to — doesn't render at all).

vi.mock("../../hooks/useIsMobile", () => ({ default: vi.fn(() => false) }));
vi.mock("../../hooks/useWarmImport", () => ({ default: () => {} }));
vi.mock("../../hooks/useUtilityPayLinks", () => ({ useUtilityPayLinks: () => ({}) }));

vi.mock("./useCalendarWorkspaceState.js", () => ({
  default: () => ({
    calendarOpenRequestId: 0,
    calendarJumpTodayRequestId: 0,
    calendarView: "events",
    calendarFocus: null,
    calendarFocusItemId: null,
    calendarFocusOpenDetail: false,
    calendarForceOverlays: false,
    openCalendar: vi.fn(),
    jumpCalendarToToday: vi.fn(),
    changeCalendarView: vi.fn(),
    handleCalendarEventsRangeChange: vi.fn(),
  }),
}));

vi.mock("./useAlfredPanelState.js", () => ({
  default: () => ({
    alfredOpen: false,
    alfredMounted: false,
    alfredNewChatTick: 0,
    alfredHandoff: null,
    toggleAlfred: vi.fn(),
    closeAlfred: vi.fn(),
    alfredNewChat: vi.fn(),
    askAlfred: vi.fn(),
  }),
}));

vi.mock("./useLiveReadOverrides.js", () => ({
  default: () => ({
    liveReadOverrides: {},
    handleLiveReadOverrideChange: vi.fn(),
    inboxUnreadSignalCount: 0,
  }),
}));

vi.mock("./useDashboardShellHotkeys.js", () => ({ default: () => {} }));

vi.mock("./DashboardBody.jsx", () => ({
  DashboardBody: () => <div data-testid="dashboard-body-stub" />,
}));
vi.mock("./DashboardShellOverlays.jsx", () => ({ default: () => null }));
vi.mock("./DashboardCalendarModalMount.jsx", () => ({
  default: () => null,
  importCalendar: () => Promise.resolve({}),
}));
vi.mock("../inbox/InboxView", () => ({
  default: () => <div data-testid="inbox-view-stub" />,
}));
vi.mock("../notes/NotesTab", () => ({
  default: () => <div data-testid="notes-tab-stub" />,
}));
vi.mock("../news/NewsTab", () => ({
  default: () => <div data-testid="news-tab-stub" />,
}));
vi.mock("../alfred/AlfredPanel", () => ({ default: () => null }));

// DashboardShell persists the active tab to localStorage ("ea:tab") and reads
// it back as the initial tab on mount — clear it after every test so one
// test's tab switch can't leak into the next test's initial render.
afterEach(() => {
  localStorage.clear();
});

function renderShell() {
  return render(
    <MemoryRouter>
      <DashboardProvider deadlines={null} setCalendarDeadlines={() => {}}>
        <DashboardShell
          bd={{ briefing: null, refreshing: false }}
          liveData={{
            isPolling: false,
            systemStatus: { state: "current", sources: [] },
            liveEmails: [],
          }}
          calendarRange={{}}
          activeSnapshot={{
            snapshot: null,
            loading: false,
            error: null,
            refresh: async () => {},
            sync: async () => {},
          }}
          onQuickRefresh={() => {}}
          historyOpen={false}
          setHistoryOpen={() => {}}
          historyTriggerRef={{ current: null }}
          calendarDeadlines={null}
          calendarDeadlinesLoading={false}
        />
      </DashboardProvider>
    </MemoryRouter>,
  );
}

describe("DashboardShell tab <-> tabpanel ARIA linkage", () => {
  afterEach(() => {
    cleanup();
    useIsMobile.mockReturnValue(false);
  });

  it("marks the active tab's panel role=tabpanel, linked to its tab via aria-labelledby", async () => {
    renderShell();

    const panel = await screen.findByRole("tabpanel");
    expect(panel.id).toBe("shell-tabpanel-dashboard");
    expect(panel.getAttribute("aria-labelledby")).toBe("shell-tab-dashboard");
    expect(panel.hasAttribute("aria-label")).toBe(false);
  });

  it("swaps the accessible tabpanel when a different tab activates (inactive panels are hidden, not just re-labelled)", async () => {
    renderShell();
    await screen.findByRole("tabpanel");

    fireEvent.click(screen.getByRole("tab", { name: /Inbox/ }));

    const panel = await screen.findByRole("tabpanel");
    expect(panel.id).toBe("shell-tabpanel-inbox");
    expect(panel.getAttribute("aria-labelledby")).toBe("shell-tab-inbox");
    // Only one tabpanel should be in the accessibility tree at a time — the
    // dashboard tab's Activity-hidden panel must not still be queryable.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });
});

describe("DashboardShell tabpanel naming on mobile (no desktop ShellTabs)", () => {
  afterEach(() => {
    cleanup();
    useIsMobile.mockReturnValue(false);
  });

  it("falls back to a plain aria-label instead of a dangling aria-labelledby", async () => {
    useIsMobile.mockReturnValue(true);
    renderShell();

    // ShellTabs (and thus id="shell-tab-dashboard") doesn't render on mobile —
    // ShellHeader gates it behind `!isMobile`.
    expect(screen.queryByRole("tablist", { name: "Primary" })).toBeNull();
    expect(document.getElementById("shell-tab-dashboard")).toBeNull();

    const panel = await screen.findByRole("tabpanel", { name: "Dashboard" });
    expect(panel.id).toBe("shell-tabpanel-dashboard");
    expect(panel.hasAttribute("aria-labelledby")).toBe(false);
    expect(panel.getAttribute("aria-label")).toBe("Dashboard");
  });
});
