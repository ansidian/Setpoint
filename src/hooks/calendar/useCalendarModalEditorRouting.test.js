import { describe, expect, it } from "vitest";
import {
  resolveFloatingDeadlineItemId,
  resolveFloatingEventItemId,
} from "./useCalendarModalEditorRouting.js";

describe("useCalendarModalEditorRouting", () => {
  it("keeps floating deadline saves keyed to the agenda selection id", () => {
    const activeView = {
      getItemId: (task) => `todoist:${task.id}-${task.due_date}`,
    };

    expect(resolveFloatingDeadlineItemId(activeView, {
      id: "task-1",
      due_date: "2026-05-12",
    })).toBe("todoist:task-1-2026-05-12");
  });

  it("falls back to the current floating event id when a saved event has no resolved view id", () => {
    expect(resolveFloatingEventItemId({}, {}, { itemId: "agenda-event-id" }))
      .toBe("agenda-event-id");
  });
});
