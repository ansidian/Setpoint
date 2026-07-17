import { describe, expect, it } from "vitest";
import { selectGlanceActions } from "./glanceActionsModel";
import type { GlanceAction } from "./glanceActionsModel";

const keys = (actions: GlanceAction[]) => actions.map((action) => action.key);

describe("selectGlanceActions — deadlines", () => {
  const task = (overrides: Record<string, unknown> = {}) => ({ id: "t1", status: "incomplete", ...overrides });

  it("offers complete, edit, todoist, and open-in-calendar for an incomplete todoist task", () => {
    const actions = selectGlanceActions({
      kind: "deadline",
      item: task({ url: "https://todoist.com/app/task/1" }),
    });
    expect(keys(actions)).toEqual(["complete", "edit", "todoist", "openInCalendar"]);
  });

  it("drops complete once the deadline is done", () => {
    const actions = selectGlanceActions({ kind: "deadline", item: task({ status: "complete" }) });
    expect(keys(actions)).toEqual(["edit", "openInCalendar"]);
  });

  it("drops todoist when the url is missing or not a todoist link", () => {
    expect(keys(selectGlanceActions({ kind: "deadline", item: task() }))).toEqual(["complete", "edit", "openInCalendar"]);
    expect(keys(selectGlanceActions({ kind: "deadline", item: task({ url: "https://example.com/x" }) })))
      .toEqual(["complete", "edit", "openInCalendar"]);
  });

  it("always ends with open-in-calendar as a command (not a link)", () => {
    const actions = selectGlanceActions({ kind: "deadline", item: task() });
    const last = actions[actions.length - 1];
    expect(last!.key).toBe("openInCalendar");
    expect(last!.type).toBe("command");
    expect(last!.href).toBeUndefined();
  });
});

describe("selectGlanceActions — bills", () => {
  const bill = (overrides: Record<string, unknown> = {}) => ({ id: "b1", scheduleId: "s1", ...overrides });
  const ctx = {
    actualBudgetUrl: "https://actual.example",
    payLinksByScheduleId: { s1: "https://pay.example/s1" },
  };

  it("offers open-in-actual, pay, and open-in-calendar when both urls resolve", () => {
    const actions = selectGlanceActions({ kind: "bill", item: bill(), ctx });
    expect(keys(actions)).toEqual(["actual", "pay", "openInCalendar"]);
  });

  it("builds the actual schedule url as a link href", () => {
    const actions = selectGlanceActions({ kind: "bill", item: bill(), ctx });
    const actual = actions.find((a) => a.key === "actual");
    expect(actual!.type).toBe("link");
    expect(actual!.href).toBe("https://actual.example/schedules?highlight=s1");
  });

  it("drops actual without a budget url and pay without a pay link", () => {
    expect(keys(selectGlanceActions({ kind: "bill", item: bill(), ctx: {} }))).toEqual(["openInCalendar"]);
    expect(keys(selectGlanceActions({ kind: "bill", item: bill(), ctx: { actualBudgetUrl: "https://actual.example" } })))
      .toEqual(["actual", "openInCalendar"]);
  });
});

describe("selectGlanceActions — events", () => {
  const ev = (overrides: Record<string, unknown> = {}) => ({ id: "e1", ...overrides });

  it("offers zoom, open-url, google-calendar, and open-in-calendar when present", () => {
    const actions = selectGlanceActions({
      kind: "event",
      item: ev({
        description: "Join https://zoom.us/j/123 — notes at https://docs.example.com/x",
        htmlLink: "https://calendar.google.com/event?eid=abc",
      }),
    });
    expect(keys(actions)).toEqual(["zoom", "eventUrl", "gcal", "openInCalendar"]);
  });

  it("falls back to only open-in-calendar for a plain event with no links", () => {
    expect(keys(selectGlanceActions({ kind: "event", item: ev({ title: "Standup" }) }))).toEqual(["openInCalendar"]);
  });

  it("never offers edit on the glance sheet (events edit only in the calendar)", () => {
    const actions = selectGlanceActions({
      kind: "event",
      item: ev({ writable: true, eventType: "default", htmlLink: "https://calendar.google.com/event?eid=abc" }),
    });
    expect(keys(actions)).not.toContain("edit");
  });
});
