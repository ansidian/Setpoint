import { describe, expect, it } from "vitest";
import {
  resolveDashboardCurrentEventPlan,
  resolveDashboardRefreshPlan,
  shouldTriggerSyncHotkey,
} from "./Dashboard.refreshModel.js";

describe("dashboard refresh model", () => {
  it("triggers sync for a plain R keydown from the page body", () => {
    expect(shouldTriggerSyncHotkey({
      key: "r",
      target: { tagName: "BODY", isContentEditable: false },
    })).toBe(true);
  });

  it("ignores keys other than lowercase R", () => {
    expect(shouldTriggerSyncHotkey({
      key: "x",
      target: { tagName: "BODY", isContentEditable: false },
    })).toBe(false);
  });

  it("ignores repeated R keydowns", () => {
    expect(shouldTriggerSyncHotkey({
      key: "r",
      repeat: true,
      target: { tagName: "BODY", isContentEditable: false },
    })).toBe(false);
  });

  it("ignores modified R keydowns", () => {
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
      expect(shouldTriggerSyncHotkey({
        key: "r",
        [modifier]: true,
        target: { tagName: "BODY", isContentEditable: false },
      })).toBe(false);
    }
  });

  it("ignores R keydowns from contenteditable targets", () => {
    expect(shouldTriggerSyncHotkey({
      key: "r",
      target: { tagName: "DIV", isContentEditable: true },
    })).toBe(false);
  });

  it("ignores R keydowns from select controls", () => {
    expect(shouldTriggerSyncHotkey({
      key: "r",
      target: { tagName: "SELECT", isContentEditable: false },
    })).toBe(false);
  });

  it("ignores R keydowns from text-entry controls", () => {
    for (const tagName of ["INPUT", "TEXTAREA"]) {
      expect(shouldTriggerSyncHotkey({
        key: "r",
        target: { tagName, isContentEditable: false },
      })).toBe(false);
    }
  });

  it("ignores R while dashboard refresh or current sync work is active", () => {
    const event = {
      key: "r",
      target: { tagName: "BODY", isContentEditable: false },
    };

    expect(shouldTriggerSyncHotkey(event, { refreshing: true })).toBe(false);
    expect(shouldTriggerSyncHotkey(event, { syncing: true })).toBe(false);
  });

  it("keeps timer refresh separate from explicit user refresh work", () => {
    expect(resolveDashboardRefreshPlan({ trigger: "timer" })).toMatchObject({
      shouldRun: true,
      syncActiveSnapshot: true,
      refreshVisibleEvents: null,
      markCalendarEventsStale: false,
      markDeadlineRangeStale: false,
      markBillRangeStale: false,
      markBillsRefreshRequested: false,
      refreshCalendarDomains: null,
    });

    expect(resolveDashboardRefreshPlan({ trigger: "explicit" })).toMatchObject({
      shouldRun: true,
      syncActiveSnapshot: true,
      refreshVisibleEvents: null,
      markCalendarEventsStale: true,
      markDeadlineRangeStale: true,
      markBillRangeStale: true,
      markBillsRefreshRequested: true,
      refreshCalendarDomains: { force: true, includeBills: true },
    });
  });

  it("refreshes the visible events range in place for explicit sync when the events workspace is open", () => {
    expect(resolveDashboardRefreshPlan({
      trigger: "explicit",
      calendarWorkspace: {
        open: true,
        view: "events",
        eventsRange: { start: "2026-05-01", end: "2026-05-31" },
      },
    })).toMatchObject({
      refreshVisibleEvents: { start: "2026-05-01", end: "2026-05-31" },
      markCalendarEventsStale: false,
      markDeadlineRangeStale: true,
      markBillRangeStale: true,
    });
  });

  it("ignores refresh requests while a current sync is already running", () => {
    expect(resolveDashboardRefreshPlan({
      trigger: "explicit",
      currentSyncing: true,
    })).toEqual({ shouldRun: false });
  });

  it("maps dashboard-current events to domain freshness work", () => {
    expect(resolveDashboardCurrentEventPlan({
      source: "bills",
      state: "current",
    })).toEqual({
      markBillsRefreshRequested: true,
      markBillRangeStale: true,
      markDeadlineRangeStale: false,
      refreshCalendarDomains: null,
    });

    expect(resolveDashboardCurrentEventPlan({
      source: "todoist",
      state: "current",
    })).toEqual({
      markBillsRefreshRequested: false,
      markBillRangeStale: false,
      markDeadlineRangeStale: true,
      refreshCalendarDomains: { force: true, includeBills: false },
    });
  });
});
