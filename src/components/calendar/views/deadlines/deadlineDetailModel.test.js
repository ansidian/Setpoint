import { describe, expect, it } from "vitest";
import {
  deadlineContextLabel,
  deadlineDueBadgeLabel,
  deadlineDueDetailLabel,
  deadlineSecondaryMeta,
  deadlineTitle,
  shouldCompressDeadlineCard,
} from "./deadlineDetailModel.js";

describe("deadline detail model", () => {
  it("derives display labels from Todoist and CTM deadline shapes", () => {
    const todoistTask = {
      title: "Submit annotated bibliography",
      project_name: "School",
      due_date: "2026-05-02",
      due_time: "3:30 PM",
    };
    const ctmTask = {
      name: "Quiz window closes",
      class_name: "Data Systems",
    };

    expect(deadlineTitle(todoistTask)).toBe("Submit annotated bibliography");
    expect(deadlineTitle(ctmTask)).toBe("Quiz window closes");
    expect(deadlineTitle({})).toBe("Untitled task");
    expect(deadlineContextLabel(todoistTask)).toBe("School");
    expect(deadlineContextLabel(ctmTask)).toBe("Data Systems");
    expect(deadlineDueBadgeLabel(todoistTask, 0)).toBe("Today");
    expect(deadlineDueBadgeLabel(ctmTask, null)).toBe("No due date");
    expect(deadlineDueDetailLabel(todoistTask)).toBe("3:30 PM");
    expect(deadlineDueDetailLabel({ due_date: "2026-05-02" })).toBe("End of day");
    expect(deadlineSecondaryMeta(ctmTask)).toBe("Data Systems");
  });

  it("compresses deadline cards only when text density needs it", () => {
    expect(shouldCompressDeadlineCard(null)).toBe(false);
    expect(shouldCompressDeadlineCard({
      title: "Read",
      project_name: "School",
      due_date: "2026-05-02",
    })).toBe(false);
    expect(shouldCompressDeadlineCard({
      title: "Submit final revised research essay",
      class_name: "English",
      due_date: "2026-05-02",
    })).toBe(true);
    expect(shouldCompressDeadlineCard({
      title: "Quiz",
      class_name: "Very long course context that needs compression",
      due_date: "2026-05-02",
    })).toBe(true);
  });
});
