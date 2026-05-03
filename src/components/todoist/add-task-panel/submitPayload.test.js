import { describe, expect, it } from "vitest";
import { buildTodoistTaskPayload } from "./submitPayload";

describe("Todoist add-task submit payload", () => {
  it("builds the create payload from parsed task metadata", () => {
    expect(buildTodoistTaskPayload({
      parsed: { stripped: "Submit lab notes" },
      description: "  include screenshots  ",
      resolvedProject: { id: "school", name: "School" },
      resolvedPriority: 2,
      resolvedLabels: [{ id: "lab", name: "lab" }],
      resolvedDue: "2026-04-22 at 9:00 AM",
    })).toEqual({
      content: "Submit lab notes",
      description: "include screenshots",
      project_id: "school",
      priority: 2,
      labels: ["lab"],
      due_string: "2026-04-22 at 9:00 AM",
    });
  });

  it("keeps empty edit labels so saving can clear Todoist labels", () => {
    expect(buildTodoistTaskPayload({
      parsed: { stripped: "Follow up" },
      resolvedLabels: [],
      isEdit: true,
    })).toEqual({
      content: "Follow up",
      labels: [],
    });
  });

  it("omits unset optional fields from create payloads", () => {
    expect(buildTodoistTaskPayload({
      parsed: { stripped: "Plan sprint" },
      description: " ",
      resolvedLabels: [],
    })).toEqual({
      content: "Plan sprint",
    });
  });
});
