import { describe, expect, it } from "vitest";
import { buildDeadlineMutationPayload, canSubmitTask } from "./submitPayload";

describe("canSubmitTask", () => {
  it("disables submit for tokens-only input that strips to an empty title", () => {
    // "#Work @home !1" -> all tokens resolved, parsed.stripped === "".
    // Submitting would POST an empty title that the server rejects with 400.
    expect(canSubmitTask({ parsed: { stripped: "" }, input: "#Work @home !1" })).toBe(false);
  });

  it("disables submit for whitespace-only stripped titles", () => {
    expect(canSubmitTask({ parsed: { stripped: "   " }, input: "  " })).toBe(false);
  });

  it("enables submit when a real title survives token stripping", () => {
    expect(canSubmitTask({ parsed: { stripped: "Pay rent" }, input: "Pay rent #Work" })).toBe(true);
  });

  it("falls back to raw input before parsing has run", () => {
    expect(canSubmitTask({ parsed: null, input: "Draft notes" })).toBe(true);
    expect(canSubmitTask({ parsed: null, input: "   " })).toBe(false);
  });
});

describe("deadline add-task submit payload", () => {
  it("builds the create payload from parsed task metadata", () => {
    expect(buildDeadlineMutationPayload({
      parsed: { stripped: "Submit lab notes" },
      description: "  include screenshots  ",
      resolvedProject: { id: "school", name: "School" },
      resolvedPriority: 2,
      resolvedLabels: [{ id: "lab", name: "lab" }],
      resolvedDue: "2026-04-22 at 9:00 AM",
    })).toEqual({
      title: "Submit lab notes",
      description: "include screenshots",
      projectId: "school",
      priority: 2,
      labelIds: ["lab"],
      dueString: "2026-04-22 at 9:00 AM",
    });
  });

  it("keeps empty edit labels so saving can clear deadline labels", () => {
    expect(buildDeadlineMutationPayload({
      parsed: { stripped: "Follow up" },
      resolvedLabels: [],
      isEdit: true,
    })).toEqual({
      title: "Follow up",
      labelIds: [],
    });
  });

  it("omits unset optional fields from create payloads", () => {
    expect(buildDeadlineMutationPayload({
      parsed: { stripped: "Plan sprint" },
      description: " ",
      resolvedLabels: [],
    })).toEqual({
      title: "Plan sprint",
    });
  });

  it("falls back to the raw input when the stripped title is empty (tokens-only)", () => {
    // "#Shopping" strips to an empty title; `??` would keep "" and blank the task,
    // so the payload must fall back to the raw input via `||`.
    expect(buildDeadlineMutationPayload({
      parsed: { stripped: "" },
      input: "#Shopping",
      resolvedLabels: [],
    })).toEqual({
      title: "#Shopping",
    });
  });
});
