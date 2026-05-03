import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardHero from "./DashboardHero.jsx";
import TodayTimeline from "./TodayTimeline.jsx";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import { DashboardBody } from "../../pages/Dashboard.jsx";
import { resolveDashboardBodyLayout } from "./dashboardBodyLayoutModel.js";
import CustomizePanel from "../shell/CustomizePanel.jsx";

afterEach(() => {
  cleanup();
});

function makeBriefing(overrides = {}) {
  return {
    model: "Claude",
    aiInsights: [{ id: "ins-1", text: "You have a heavier deadline cluster than usual." }],
    weather: { temp: 71, condition: "Sunny", city: "Los Angeles" },
    calendar: [],
    ctm: {
      upcoming: [
        { id: "ctm-1", title: "Finalize deck", due_date: "2026-04-20", source: "canvas", class_name: "Ops" },
      ],
    },
    todoist: {
      upcoming: [
        { id: "todo-1", title: "Reply to recruiter", due_date: "2026-04-19", source: "todoist", priority: 1, status: "open" },
      ],
    },
    emails: {
      summary: "The day is manageable if you handle the near-term deadlines first.",
      accounts: [
        {
          important: [
            {
              id: "email-1",
              subject: "Need approval on the revised timeline",
              from: "Alex",
              date: "2026-04-19T15:30:00.000Z",
              read: false,
            },
          ],
          unread: 1,
        },
      ],
    },
    ...overrides,
  };
}

function renderDashboardBody({ isMobile = false, dashboardLayout = "focus", showInsights = true } = {}) {
  const briefing = makeBriefing();
  const liveData = {
    liveBills: [{ id: "bill-1", name: "Rent", amount: 1800, next_date: "2026-04-21", payee: "Landlord", paid: false }],
    liveWeather: briefing.weather,
    liveEmails: [],
  };

  return render(
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <DashboardBody
        briefing={briefing}
        liveData={liveData}
        calendarRange={{
          ensureRange: vi.fn().mockResolvedValue([]),
          getEvents: vi.fn(),
          hasMonth: vi.fn(),
          isMonthLoading: vi.fn(),
          loading: false,
          error: null,
        }}
        customize={{
          dashboardLayout,
          density: "comfortable",
          showInsights,
          showInboxPeek: true,
        }}
        accent="#cba6da"
        isMobile={isMobile}
        onOpenEmail={() => {}}
        onOpenDeadline={() => {}}
        onOpenBillsCalendar={() => {}}
        onOpenEventsCalendar={() => {}}
        onJumpSection={() => {}}
      />
    </DashboardProvider>,
  );
}

describe("mobile dashboard layout", () => {
  it("forces the mobile dashboard body into paper mode without the retired insights section", () => {
    const layoutPlan = resolveDashboardBodyLayout({
      isMobile: true,
      dashboardLayout: "command",
      showInboxPeek: true,
      showNotes: true,
    });

    expect(layoutPlan.layoutMode).toBe("paper");
    expect(layoutPlan.mobileSectionOrder).toEqual(["deadlines", "bills", "inbox-peek"]);

    renderDashboardBody({ isMobile: true, dashboardLayout: "command", showInsights: true });

    const body = screen.getByTestId("dashboard-body-mobile");
    expect(body.getAttribute("data-layout-mode")).toBe("paper");
    expect(screen.queryByText("Signals")).toBeNull();
    expect(document.querySelector('[data-sect="deadlines"]')).toBeTruthy();
    expect(document.querySelector('[data-sect="bills"]')).toBeTruthy();
    expect(document.querySelector('[data-sect="inbox-peek"]')).toBeTruthy();
    expect(document.querySelector('[data-sect="insights"]')).toBeNull();
    expect(document.querySelector('[data-sect="timeline"]')).toBeTruthy();
  });

  it("keeps desktop layout selection when not mobile", () => {
    expect(resolveDashboardBodyLayout({
      isMobile: false,
      dashboardLayout: "command",
      showInboxPeek: false,
    }).commandSecondaryRailSectionOrder).toEqual(["bills"]);

    renderDashboardBody({ isMobile: false, dashboardLayout: "command" });

    expect(screen.queryByText("Signals")).toBeNull();
    const layoutRoot = document.querySelector('[data-layout-mode="command"]');
    expect(layoutRoot).toBeTruthy();
  });

  it("keeps timeline and rails inside the desktop command layout", () => {
    renderDashboardBody({ isMobile: false, dashboardLayout: "command" });

    expect(document.querySelector('[data-layout-mode="command"]')).toBeTruthy();
    expect(screen.getByTestId("dashboard-command-rails")).toBeTruthy();
    expect(screen.getByTestId("today-timeline")).toBeTruthy();
    expect(document.querySelector('[data-sect="deadlines"]')).toBeTruthy();
    expect(document.querySelector('[data-sect="bills"]')).toBeTruthy();
    expect(document.querySelector('[data-sect="inbox-peek"]')).toBeTruthy();
  });

  it("gives the inbox peek open button an interactive hover state", () => {
    renderDashboardBody({ isMobile: false, dashboardLayout: "focus" });

    const openButton = screen.getByRole("button", { name: /open/i });
    expect(openButton.style.background).toBe("rgba(255, 255, 255, 0.015)");
    expect(openButton.style.color).toBe("rgba(205, 214, 244, 0.7)");

    fireEvent.mouseEnter(openButton);

    expect(openButton.style.background).toBe("rgba(203, 166, 218, 0.08)");
    expect(openButton.style.color).toBe("rgb(203, 166, 218)");
  });
});

describe("DashboardHero mobile layout", () => {
  it("keeps mobile callouts available without the retired insight copy", () => {
    render(
      <DashboardHero
        accent="#cba6da"
        density="comfortable"
        isMobile
        briefing={makeBriefing()}
        liveBills={[{ id: "bill-1", name: "Rent", amount: 1800, next_date: "2026-04-21", payee: "Landlord", paid: false }]}
        liveCalendar={[]}
        liveWeather={{ temp: 71, condition: "Sunny", city: "Los Angeles" }}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("dashboard-hero-mobile")).toBeTruthy();
    expect(screen.getByTestId("dashboard-hero-callouts")).toBeTruthy();
    expect(screen.queryByText("You have a heavier deadline cluster than usual.")).toBeNull();
  });

  it("shows an open-day priority summary instead of a midnight countdown when calendar is empty", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    render(
      <DashboardHero
        accent="#cba6da"
        density="comfortable"
        briefing={makeBriefing({
          calendar: [],
          ctm: {
            upcoming: [
              { id: "ctm-1", title: "Finalize deck", due_date: "2026-04-20", source: "canvas", class_name: "Ops", status: "open" },
            ],
          },
          todoist: { upcoming: [] },
        })}
        liveBills={[]}
        liveCalendar={[]}
        liveWeather={{ temp: 71, condition: "Sunny", city: "Los Angeles" }}
        onJump={() => {}}
      />,
    );

    const openDay = screen.getByTestId("focus-window-open-day");
    expect(openDay).toBeTruthy();
    expect(openDay.textContent).toMatch(/Open day/);
    expect(openDay.textContent).toMatch(/Next deadline/);
    expect(openDay.textContent).toMatch(/Finalize deck/);
    expect(openDay.textContent).toMatch(/Due tomorrow/);
    expect(openDay.textContent).not.toMatch(/Due soon/);
    expect(screen.queryByTestId("focus-window-open-day-duration")).toBeNull();
    expect(openDay.textContent).not.toMatch(/\d+h \d+m/);
    expect(screen.queryByText(/No more events today/i)).toBeNull();
  });

  it("falls back to a light hint when the open day has no pressure signals", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    render(
      <DashboardHero
        accent="#cba6da"
        density="comfortable"
        briefing={{
          model: "Claude",
          aiInsights: [],
          weather: { temp: 71, condition: "Sunny", city: "Los Angeles" },
          calendar: [],
          ctm: { upcoming: [] },
          todoist: { upcoming: [] },
          emails: { summary: "", accounts: [] },
        }}
        liveBills={[]}
        liveCalendar={[]}
        liveWeather={{ temp: 71, condition: "Sunny", city: "Los Angeles" }}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("focus-window-open-day-light")).toBeTruthy();
    expect(screen.getByText(/Calendar is open/i)).toBeTruthy();
    expect(screen.queryByText(/\d+h \d+m/)).toBeNull();
  });

  it("gives the focus pressure pill an interactive hover state", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    render(
      <DashboardHero
        accent="#cba6da"
        density="comfortable"
        briefing={makeBriefing({
          calendar: [],
          ctm: {
            upcoming: [
              { id: "ctm-1", title: "Finalize deck", due_date: "2026-04-20", source: "canvas", class_name: "Ops", status: "open" },
            ],
          },
          todoist: { upcoming: [] },
        })}
        liveBills={[]}
        liveCalendar={[]}
        liveWeather={{ temp: 71, condition: "Sunny", city: "Los Angeles" }}
        onJump={() => {}}
        onOpenPressure={() => {}}
      />,
    );

    const pressureButton = screen.getByRole("button", { name: /deadline soon/i });
    expect(pressureButton.style.background).toBe("rgba(249, 226, 175, 0.08)");
    expect(pressureButton.style.border).toBe("1px solid rgba(249, 226, 175, 0.18)");

    fireEvent.mouseEnter(pressureButton);

    expect(pressureButton.style.background).toBe("rgba(249, 226, 175, 0.12)");
    expect(pressureButton.style.border).toBe("1px solid rgba(249, 226, 175, 0.3)");
  });
});

describe("TodayTimeline controls", () => {
  it("gives inactive filter chips a clearer hover state", () => {
    render(
      <TodayTimeline
        accent="#cba6da"
        events={[]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    const deadlinesFilter = screen.getByRole("switch", { name: /deadlines/i });
    fireEvent.click(deadlinesFilter);

    expect(deadlinesFilter.getAttribute("aria-checked")).toBe("false");
    expect(deadlinesFilter.style.background).toBe("transparent");
    expect(deadlinesFilter.style.color).toBe("rgba(205, 214, 244, 0.5)");

    fireEvent.mouseEnter(deadlinesFilter);

    expect(deadlinesFilter.style.background).toBe("rgba(255, 255, 255, 0.035)");
    expect(deadlinesFilter.style.color).toBe("rgba(205, 214, 244, 0.82)");
  });

  it("keeps the now marker visible when events are toggled off", () => {
    render(
      <TodayTimeline
        accent="#cba6da"
        events={[]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("timeline-now-marker")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: /events/i }));

    expect(screen.getByTestId("timeline-now-marker")).toBeTruthy();
  });
});

describe("CustomizePanel mobile options", () => {
  it("hides dashboard layout and density controls on mobile", () => {
    render(
      <CustomizePanel
        open
        onClose={() => {}}
        tab="dashboard"
        isMobile
        customize={{
          accent: "#cba6da",
          serifChoice: "Instrument Serif",
          dashboardLayout: "focus",
          inboxLayout: "two-pane",
          inboxGrouping: "swimlanes",
          density: "comfortable",
          inboxDensity: "default",
          aiVerbosity: "standard",
          showInsights: true,
          showInboxPeek: true,
          showPreview: true,
          sidebarCompact: false,
          setKey: () => {},
          reset: () => {},
        }}
      />,
    );

    expect(screen.queryByText("Dashboard layout")).toBeNull();
    expect(screen.queryByText("Dashboard density")).toBeNull();
    expect(screen.queryByText("Show signals")).toBeNull();
    expect(screen.getByText("Show inbox peek")).toBeTruthy();
  });

  it("hides desktop-only inbox controls on mobile", () => {
    render(
      <CustomizePanel
        open
        onClose={() => {}}
        tab="inbox"
        isMobile
        customize={{
          accent: "#cba6da",
          serifChoice: "Instrument Serif",
          dashboardLayout: "focus",
          inboxLayout: "two-pane",
          inboxGrouping: "swimlanes",
          density: "comfortable",
          inboxDensity: "default",
          aiVerbosity: "standard",
          showInsights: true,
          showInboxPeek: true,
          showPreview: true,
          sidebarCompact: false,
          setKey: () => {},
          reset: () => {},
        }}
      />,
    );

    expect(screen.queryByText("Inbox layout")).toBeNull();
    expect(screen.queryByText("Grouping")).toBeNull();
    expect(screen.queryByText("Inbox density")).toBeNull();
    expect(screen.queryByText("Show previews in list")).toBeNull();
    expect(screen.queryByText("Compact sidebar")).toBeNull();
    expect(screen.getByText("Briefing detail")).toBeTruthy();
  });
});

describe("TodayTimeline mobile layout", () => {
  it("uses the mobile timeline row for mobile events", () => {
    render(
      <TodayTimeline
        accent="#cba6da"
        isMobile
        events={[
          {
            id: "ev-1",
            title: "Staff sync",
            startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T18:30:00.000Z").getTime(),
            location: "Zoom",
          },
        ]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    const row = screen.getByTestId("timeline-row-mobile");

    expect(row.textContent).toMatch(/Staff sync/);
    expect(row.textContent).toMatch(/Zoom/);
    expect(screen.queryByTestId("timeline-row-desktop")).toBeNull();
  });
});
