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
});

describe("selectGlanceActions — events", () => {
  const ev = (overrides: Record<string, unknown> = {}) => ({ id: "e1", ...overrides });

  it("edits writable events in place and omits editing for read-only events", () => {
    expect(keys(selectGlanceActions({ kind: "event", item: ev({ title: "Standup", writable: true }) }))).toEqual(["edit"]);
    expect(keys(selectGlanceActions({ kind: "event", item: ev({ title: "Holiday", writable: false }) }))).toEqual([]);
  });
});
