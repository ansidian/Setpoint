import { describe, expect, it } from "vitest";
import { makeCalendarBillsData } from "./calendarBillsData";
import { dashboardCalendarDeadlineData } from "./dashboardCalendarModalModel";
import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";

describe("dashboard calendar modal projection", () => {
  it("seeds deadline data from the current dashboard while the range is loading", () => {
    const deadline = { id: "deadline-current", title: "Current dashboard task", due_date: "2026-04-20" };
    expect(dashboardCalendarDeadlineData({ upcoming: [deadline] }, true)).toEqual({
      upcoming: [deadline],
      stats: null,
      syncHealth: null,
      isLoading: true,
    });
  });

  it("preserves mirrored bill occurrence identity and paid state", () => {
    const occurrence = {
      id: "sched-1:2026-05-10",
      scheduleId: "sched-1",
      name: "Mortgage",
      next_date: "2026-05-10",
      paid: true,
    };
    const projected = makeCalendarBillsData({
      allSchedules: [occurrence],
      payeeMap: {},
      actualBudgetUrl: "https://actual.example.test",
    } as CurrentDashboardLiveData);
    expect(projected.schedules).toEqual([occurrence]);
  });
});
